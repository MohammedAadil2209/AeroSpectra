import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (fn: (d: T | null) => T | null) => void;
}

/** Fetch helper with loading/error state; stale responses are ignored. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => {
        if (my === seq.current) {
          setDataState(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (my === seq.current) {
          setError(e.message || 'Request failed');
          setDataState(null); // never show stale data from another scope next to an error
        }
      })
      .finally(() => my === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((f: (d: T | null) => T | null) => setDataState(f), []);
  return { data, loading, error, reload, setData };
}

export function useInterval(cb: () => void, ms: number | null) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
