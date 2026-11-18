/**
 * Minimal Subject of the Observer pattern. Subscribers are notified with the latest value;
 * `subscribe` returns an unsubscribe function (fits React's useEffect cleanup).
 */
export type Listener<T> = (value: T) => void;

export class Observable<T> {
  private listeners = new Set<Listener<T>>();

  constructor(protected value: T) {}

  get current(): T {
    return this.value;
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    listener(this.value); // replay current state to the new subscriber
    return () => {
      this.listeners.delete(listener);
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  protected emit(next: T): void {
    this.value = next;
    this.listeners.forEach((l) => l(next));
  }
}
