import { Entity } from './Entity.js';
import type { Screen } from './Screen.js';

/** Aggregation: a Theatre groups Screens. */
export class Theatre extends Entity {
  readonly #screens: Screen[];

  constructor(
    id: number,
    readonly name: string,
    readonly city: string,
    readonly address: string,
    screens: Screen[] = [],
  ) {
    super(id);
    this.#screens = [...screens];
  }

  get screens(): readonly Screen[] {
    return this.#screens;
  }
}
