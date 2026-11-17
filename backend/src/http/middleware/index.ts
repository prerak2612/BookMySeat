import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import type { User } from '../../domain/User.js';
import type { AuthService } from '../../services/AuthService.js';
import { IdempotencyKeyHeader } from '../validators/schemas.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    valid: { body?: unknown; query?: unknown; params?: unknown };
  }
}

// ---------------------------------------------------------------- authentication / authorisation

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export function authenticate(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedError();
    req.user = await auth.authenticate(token);
    next();
  };
}

/** Attaches the user when a valid token is present; anonymous access otherwise. */
export function optionalAuthenticate(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req);
    if (token) req.user = await auth.authenticate(token).catch(() => undefined);
    next();
  };
}

/** Polymorphic check: the concrete User subclass decides (Admin -> true, Customer -> false). */
export const requireCatalogManager: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new UnauthorizedError();
  if (!req.user.canManageCatalog()) throw new ForbiddenError('Administrator access required');
  next();
};

export function currentUser(req: Request): User {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ---------------------------------------------------------------- validation

type Part = 'body' | 'query' | 'params';

/** Parses req[part] with the schema and stores the typed result in req.valid[part]. */
export function validate(part: Part, schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    req.valid ??= {};
    req.valid[part] = schema.parse(req[part] ?? {});
    next();
  };
}

export function valid<T>(req: Request, part: Part): T {
  return req.valid[part] as T;
}

export function idempotencyKey(req: Request): string | undefined {
  return IdempotencyKeyHeader.parse(req.header('Idempotency-Key') ?? undefined);
}

// ---------------------------------------------------------------- errors

export const notFoundHandler: RequestHandler = (req) => {
  throw new AppErrorNotFoundRoute(req.method, req.path);
};

class AppErrorNotFoundRoute extends AppError {
  readonly statusCode = 404;
  readonly code = 'ROUTE_NOT_FOUND';
  constructor(method: string, path: string) {
    super(`No route for ${method} ${path}`);
  }
}

// PostgreSQL SQLSTATE -> HTTP mapping for constraint violations that reach the edge.
const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists' },
  '23503': { status: 409, code: 'REFERENCE_CONFLICT', message: 'The operation violates a reference to another record' },
  '23P01': { status: 409, code: 'SHOW_OVERLAP', message: 'Another show is already scheduled on this screen at that time' },
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'The data violates a database rule' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: 'Malformed input value' },
  '40001': { status: 409, code: 'CONCURRENT_UPDATE', message: 'The request conflicted with a concurrent update, please retry' },
  '40P01': { status: 409, code: 'CONCURRENT_UPDATE', message: 'The request conflicted with a concurrent update, please retry' },
};

/** Centralised error handler: every error leaves the API in the same envelope. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL_ERROR', message: 'Something went wrong' };

  if (err instanceof AppError) {
    status = err.statusCode;
    body = err.toJSON();
  } else if (err instanceof ZodError) {
    status = 400;
    body = new ValidationError('Request validation failed', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))).toJSON();
  } else if (typeof err === 'object' && err !== null && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' };
  } else if (typeof err === 'object' && err !== null && PG_ERRORS[(err as { code?: string }).code ?? '']) {
    const mapped = PG_ERRORS[(err as { code: string }).code]!;
    status = mapped.status;
    body = { code: mapped.code, message: mapped.message };
  }

  if (status >= 500) logger.error('request.failed', { method: req.method, path: req.path, error: (err as Error)?.stack ?? String(err) });
  res.status(status).json({ success: false, error: body });
}

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}
