import { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";

type Page<T> = { items: T[]; next: string | null };

// Replace the visible page; failed navigation keeps the current records and
// retries the same cursor. Callers remount this hook when filters change.
export function useCursorPage<T>(endpoint: string) {
  const [page, setPage] = useState<Page<T>>({ items: [], next: null });
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const attempt = useRef<(string | null)[]>([null]);
  const load = async (target: (string | null)[]) => {
    if (pending.current) return;
    attempt.current = target;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    const cursor = target.at(-1);
    try {
      const result = await request<Page<T>>(
        endpoint +
          (cursor
            ? `${endpoint.includes("?") ? "&" : "?"}after=${encodeURIComponent(cursor)}`
            : ""),
        { signal: controller.signal },
      );
      if (pending.current !== controller || controller.signal.aborted) return;
      setPage(result);
      setHistory(target);
      setLoaded(true);
    } catch (err) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : "The page could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load([null]);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  return {
    ...page,
    busy,
    loaded,
    error,
    pageNumber: history.length,
    previous: () => history.length > 1 && void load(history.slice(0, -1)),
    nextPage: () => page.next && void load([...history, page.next]),
    retry: () => void load(attempt.current),
  };
}
