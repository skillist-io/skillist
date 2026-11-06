import { type RefObject, useEffect } from "react";

const ITEMS = "a[href], button:not([disabled])";

/**
 * One Tab stop for a long list of links and buttons, with arrow keys inside it.
 *
 * Every tree row used to be its own stop, which put the page 50-odd Tabs behind
 * the sidebar. Rows appear and disappear as branches open, so tab order is kept
 * right by watching the DOM rather than by each row knowing its own position.
 *
 * This is keyboard behaviour only, not `role="tree"`: the rows are real links
 * and buttons, and screen readers keep reading them as those.
 */
export function useRovingFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const items = () => [...root.querySelectorAll<HTMLElement>(ITEMS)];
    let current: HTMLElement | null = null;

    const settle = () => {
      const all = items();
      if (!current || !all.includes(current)) {
        // Prefer where the reader is, so Tab lands on the open page's row.
        current = all.find((el) => el.getAttribute("aria-current") === "page") ?? all[0] ?? null;
      }
      for (const el of all) el.tabIndex = el === current ? 0 : -1;
    };

    const move = (target: HTMLElement | undefined) => {
      if (!target) return;
      current = target;
      settle();
      target.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const all = items();
      const here = all.indexOf(document.activeElement as HTMLElement);
      if (here < 0) return;
      const row = all[here];
      const expanded = row?.getAttribute("aria-expanded");

      switch (event.key) {
        case "ArrowDown":
          move(all[here + 1]);
          break;
        case "ArrowUp":
          move(all[here - 1]);
          break;
        case "Home":
          move(all[0]);
          break;
        case "End":
          move(all[all.length - 1]);
          break;
        case "ArrowRight":
          if (expanded === "false") row?.click();
          else if (expanded === "true") move(all[here + 1]);
          else return;
          break;
        case "ArrowLeft":
          if (expanded === "true") row?.click();
          else return;
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && items().includes(event.target)) {
        current = event.target;
        settle();
      }
    };

    settle();
    const observer = new MutationObserver(settle);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focusin", onFocusIn);

    return () => {
      observer.disconnect();
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focusin", onFocusIn);
    };
  }, [ref]);
}
