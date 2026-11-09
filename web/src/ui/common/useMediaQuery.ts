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
 * Controls under the photo: the window is taller than wide (a phone held upright, a portrait tablet or window). In
 * landscape they sit in the sidebar on the right. Keep in step with `@media (orientation: portrait)` in styles.css.
 */
export const STACKED = '(orientation: portrait)';

/**
 * Upright phones whose browser leaves the page at most 720 px of height: regular iPhones in Safari (about 550 px on an
 * SE, 660 on a 15 or 16), not the Plus or Max (about 740+). Keep in step with the same query in styles.css.
 */
export const SHORT_SCREEN = '(orientation: portrait) and (max-height: 720px)';

/** Phones upright: the width at which styles.css puts the app switcher on its own line (560 px). */
export const PHONE_WIDTH = '(max-width: 560px)';

/**
 * Phones, upright or on their side (a landscape phone is at most about 430 px tall): Browser, the folder-and-photo
 * browser, needs more room than they have, so it is left out there and stays on tablets and desktops (a phone's
 * "desktop site" mode counts as a desktop).
 */
export const PHONE_SCREEN = `${PHONE_WIDTH}, (orientation: landscape) and (max-height: 480px)`;

/**
 * Big screens turned sideways: the tool bar's buttons sit at the top of the right sidebar. Keep in step with the
 * query above `.editor:has(> .workspace)` in styles.css.
 */
export const BIG_LANDSCAPE = '(orientation: landscape) and (min-width: 1000px) and (min-height: 600px)';
