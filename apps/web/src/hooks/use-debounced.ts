import { useEffect, useState } from 'react';

/** `value` once it has stopped changing for 300 ms: one search request per pause, not per key. */
export function useDebounced<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), 300);
    return () => clearTimeout(id);
  }, [value]);
  return settled;
}
