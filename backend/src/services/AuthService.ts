import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ConflictError, UnauthorizedError } from '../common/errors.js';
import { UserRole } from '../domain/enums.js';
import type { User } from '../domain/User.js';
import type { UserRepository } from '../repositories/interfaces.js';

// ---------------------------------------------------------------- small, swappable collaborators (DIP)

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds: number) {}
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }
  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

export interface TokenPayload {
  sub: number;
  role: UserRole;
}

export interface TokenService {
  issue(payload: TokenPayload): string;
  verify(token: string): TokenPayload;
}

export class JwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  issue(payload: TokenPayload): string {
    return jwt.sign({ role: payload.role }, this.secret, {
      subject: String(payload.sub),
      expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  verify(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
      return { sub: Number(decoded.sub), role: decoded.role as UserRole };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}

// ---------------------------------------------------------------- service

export interface AuthResult {
  token: string;
  user: ReturnType<User['toPublic']>;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  /** Self-registration always creates a CUSTOMER; admins are provisioned by seed/ops. */
  async register(input: { name: string; email: string; password: string }): Promise<AuthResult> {
    if (await this.users.findByEmail(input.email)) {
      throw new ConflictError('An account with this email already exists');
    }
    const user = await this.users.create({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      passwordHash: await this.hasher.hash(input.password),
      role: UserRole.CUSTOMER,
    });
    return this.issue(user);
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    // Same error for unknown e-mail and wrong password: do not leak which accounts exist.
    if (!user || !(await this.hasher.verify(input.password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    return this.issue(user);
  }

  /** Resolves a bearer token to a live user (so deleted users / role changes take effect). */
  async authenticate(token: string): Promise<User> {
    const payload = this.tokens.verify(token);
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User no longer exists');
    return user;
  }

  private issue(user: User): AuthResult {
    return { token: this.tokens.issue({ sub: user.id, role: user.role }), user: user.toPublic() };
  }
}
