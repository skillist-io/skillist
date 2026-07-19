import { type RefObject, useEffect, useState } from "react";

/**
 * Reports whether an element is currently on screen, so expensive work (a
 * requestAnimationFrame loop, a video) can be suspended while it is not.
 *
 * This is the useful half of the pattern Neon's site wraps in a dependency: an
 * IntersectionObserver gate around anything that animates. It is small enough
 * to own outright, so we do.
 *
 * Returns `true` when IntersectionObserver is unavailable — callers should
 * degrade to running (or to their static fallback), never to a blank surface.
 */
export function useInViewport<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = "0px", threshold = 0 }: { rootMargin?: string; threshold?: number } = {},
): boolean {
  const [inViewport, setInViewport] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry?.isIntersecting ?? false),
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold]);

  return inViewport;
}
