import type { Queryable } from '../../db/Database.js';
import { UserFactory, type User, type UserProps } from '../../domain/User.js';
import type { UserRole } from '../../domain/enums.js';
import type { UserRepository } from '../interfaces.js';

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
}

const toUser = (r: UserRow): User =>
  UserFactory.create({ id: r.id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role, createdAt: r.created_at });

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async create(data: Omit<UserProps, 'id' | 'createdAt'>): Promise<User> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.name, data.email, data.passwordHash, data.role],
    );
    return toUser(rows[0]!);
  }
}
