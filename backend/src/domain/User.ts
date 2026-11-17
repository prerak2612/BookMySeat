import { Entity } from './Entity.js';
import { UserRole } from './enums.js';

export interface UserProps {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
}

/**
 * Abstract user. Inheritance + polymorphism: authorisation questions are answered by the
 * concrete subclass, so services never write `if (role === 'ADMIN')` checks.
 */
export abstract class User extends Entity {
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
  // Encapsulation: the hash never leaves the object except through `toPublic()`'s omission.
  readonly #passwordHash: string;

  protected constructor(props: UserProps) {
    super(props.id);
    this.name = props.name;
    this.email = props.email;
    this.createdAt = props.createdAt;
    this.#passwordHash = props.passwordHash;
  }

  abstract get role(): UserRole;
  /** May this user create/modify movies, theatres, screens and shows? */
  abstract canManageCatalog(): boolean;

  /** Customers may see their own bookings; admins may see every booking. */
  canAccessBookingOf(ownerId: number): boolean {
    return this.canManageCatalog() || ownerId === this.id;
  }

  get passwordHash(): string {
    return this.#passwordHash;
  }

  toPublic(): { id: number; name: string; email: string; role: UserRole; createdAt: Date } {
    return { id: this.id, name: this.name, email: this.email, role: this.role, createdAt: this.createdAt };
  }
}

export class Customer extends User {
  constructor(props: UserProps) {
    super(props);
  }
  get role(): UserRole {
    return UserRole.CUSTOMER;
  }
  canManageCatalog(): boolean {
    return false;
  }
}

export class Admin extends User {
  constructor(props: UserProps) {
    super(props);
  }
  get role(): UserRole {
    return UserRole.ADMIN;
  }
  canManageCatalog(): boolean {
    return true;
  }
}

/** Factory: picks the concrete User subclass from the persisted role. */
export class UserFactory {
  static create(props: UserProps): User {
    switch (props.role) {
      case UserRole.ADMIN:
        return new Admin(props);
      case UserRole.CUSTOMER:
        return new Customer(props);
      default:
        throw new Error(`Unknown user role: ${String(props.role)}`);
    }
  }
}
