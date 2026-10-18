import { useEffect, useState } from 'react';

/** Whether [query] matches now, updated when it changes (window resized, phone turned). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return matches;
}
