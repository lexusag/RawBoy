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

/**
 * Phones whose browser leaves the page at most 720 px of height: regular iPhones in Safari (about 550 px on an SE,
 * 660 on a 15 or 16), not the Plus or Max (about 740+). Keep in step with the same query in styles.css.
 */
export const SHORT_SCREEN = '(max-width: 760px) and (max-height: 720px)';
