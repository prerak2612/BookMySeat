/** Base class for every persisted domain object: identity-based equality. */
export abstract class Entity {
  protected constructor(public readonly id: number) {}

  equals(other: Entity | null | undefined): boolean {
    return !!other && other.constructor === this.constructor && other.id === this.id;
  }
}
