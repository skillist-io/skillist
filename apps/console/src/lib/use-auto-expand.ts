import { useEffect, useRef, useState } from "react";

/**
 * Open state for a nav branch that should reveal itself when it contains the
 * current route.
 *
 * The asymmetry is the whole point, and it is easy to get wrong: a branch opens
 * when it *becomes* active, but never closes when it stops being active. Tying
 * open state directly to `isActive` would fold up a branch the reader opened by
 * hand the moment they navigated elsewhere — which reads as the sidebar
 * fighting them.
 *
 * Returns the same tuple shape as useState so it drops into a Collapsible.
 */
export function useAutoExpand(isActive: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(isActive);
  const wasActive = useRef(isActive);

  useEffect(() => {
    if (isActive && !wasActive.current) setOpen(true);
    wasActive.current = isActive;
  }, [isActive]);

  return [open, setOpen];
}
