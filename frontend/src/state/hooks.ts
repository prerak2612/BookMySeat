import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api/httpClient';
import type { Observable } from '../patterns/Observable';

/** Subscribes a component to an Observable (Observer pattern -> React state). */
export function useObservable<T>(subject: Observable<T>): T {
  const [value, setValue] = useState<T>(subject.current);
  useEffect(() => subject.subscribe(setValue), [subject]);
  return value;
}

/** Loads async data with loading / error state and a reload function. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    run()
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => setState({ data: null, loading: false, error: describeError(err) }));
  }, [run]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

/** Seconds remaining until `deadline`, ticking every second. */
export function useCountdown(deadline: Date | null): number {
  const calc = () => (deadline ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!deadline) return;
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline?.getTime()]);
  return left;
}
