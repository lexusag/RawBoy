import { useLayoutEffect, useRef } from 'react';

/**
 * Per-tab scroll position for a scroll container whose content switches with the tab: each tab comes back where it
 * was left, and a tab not shown yet starts at the top.
 */
export function useTabScroll<T>(tab: T) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<T, number>());
  const shown = useRef(tab);
  // Before paint, so the previous tab's position never flashes.
  useLayoutEffect(() => {
    if (shown.current === tab || !ref.current) return;
    shown.current = tab;
    ref.current.scrollTop = positions.current.get(tab) ?? 0;
  }, [tab]);
  // Recorded while scrolling: at a switch the new content is already in place and may have clamped scrollTop.
  const onScroll = () => {
    if (ref.current) positions.current.set(shown.current, ref.current.scrollTop);
  };
  return { ref, onScroll };
}
