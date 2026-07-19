import { useEffect, useRef } from "react";
import { useInViewport } from "../hooks/use-in-viewport";
import { type Field, NODE_FLASH_MS, PACKET_LIFE, stepField } from "../lib/signal-field-sim";
import { cn } from "../utils";
import { CanvasBackdrop } from "./canvas-backdrop";
import { useTheme } from "./theme-provider";

/**
 * The hero's live texture: the same 64px ruled grid <CanvasBackdrop> draws, with
 * publish events travelling across it.
 *
 * Two layers. The grid is literally <CanvasBackdrop> — CSS gradients the
 * compositor handles for free, and the reason this grid and the dashboard's
 * cannot drift apart. Above it, a canvas draws only the packets, so a frame
 * costs a clear plus a handful of marks rather than a redraw of every rule.
 *
 * Packets spawn at a grid node and move along the rules, turning at
 * intersections and lighting each node they reach before fading out. That is
 * the product's own story — publish, propagate to the edge, reach the agents —
 * drawn as the page's background rather than borrowed atmosphere. It is the
 * same event <RealtimeFanout> states numerically, which is why the two sit
 * side by side in the hero.
 *
 * Constraints it respects:
 * - Monochrome grid; signal violet only on the packets themselves, at low alpha
 *   and low count, so it stays inside the ≤10% budget (DESIGN.md §2).
 * - `prefers-reduced-motion` paints one static frame and never starts the loop.
 * - The loop is suspended whenever the hero is off screen.
 * - Narrow viewports get the static frame too: on a phone the motion is mostly
 *   off-canvas, and the frame budget is better spent elsewhere.
 *
 * Always decorative: `aria-hidden`, non-interactive, and it sits behind content
 * (give the parent `relative` and lift content with `relative z-10`).
 */

/** Matches <CanvasBackdrop>'s fade so the hero and the dashboard stay in register. */
export const signalFieldClass =
  "[mask-image:radial-gradient(120%_100%_at_15%_0%,black,transparent_70%)]";

/** Must match <CanvasBackdrop>'s backgroundSize, or packets drift off the rules. */
const CELL = 64;
/** Below this width the motion is mostly off-canvas; paint the static frame. */
const MIN_ANIMATED_WIDTH = 640;
/** How far behind its head a packet's trail reaches, in grid nodes. */
const TRAIL_NODES = 2.5;
/** dt ceiling, so a resumed tab cannot advance packets by a whole grid at once. */
const MAX_FRAME_SECONDS = 0.05;

export function SignalField({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `rootMargin` starts the field just before it scrolls in, so it is already
  // running by the time it is visible rather than popping into motion.
  const inViewport = useInViewport(containerRef, { rootMargin: "200px" });
  const { resolvedTheme } = useTheme();
  // Canvas cannot inherit from the cascade, so the token is sampled into a ref
  // that the draw calls read every frame. Keeping it in a ref (rather than in
  // the effect's closure) means a theme change re-samples the color without
  // tearing down the ResizeObserver and the packet state with it.
  const colorsRef = useRef({ signal: "" });
  const redrawRef = useRef<() => void>(() => {});

  // Declared before the render effect so colors are populated by the time the
  // first frame is drawn; afterwards, this is the only thing a theme flip runs.
  // resolvedTheme is an invalidation key rather than a value this effect reads:
  // the theme lives in the cascade, so re-sampling the computed custom
  // properties is the only way to observe it changing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidation key, see above
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const styles = getComputedStyle(container);
    colorsRef.current = { signal: styles.getPropertyValue("--signal").trim() };
    redrawRef.current();
  }, [resolvedTheme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let frame = 0;
    const field: Field = { packets: [], flashes: [] };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    /** The static frame is the CSS grid alone — nothing for the canvas to draw. */
    const drawStaticFrame = () => {
      ctx.clearRect(0, 0, width, height);
    };

    const drawPackets = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      // Nodes a packet has just reached, cooling back down.
      for (const flash of field.flashes) {
        const age = (now - flash.at) / NODE_FLASH_MS;
        if (age >= 1) continue;
        const fade = 1 - age;
        ctx.globalAlpha = fade * 0.85;
        ctx.fillStyle = colorsRef.current.signal;
        const size = 2 + fade * 2;
        ctx.fillRect(flash.gx * CELL - size / 2, flash.gy * CELL - size / 2, size, size);
      }

      for (const packet of field.packets) {
        const [dx, dy] = packet.dir;
        const x = (packet.gx + dx * packet.t) * CELL;
        const y = (packet.gy + dy * packet.t) * CELL;
        // Packets fade in over their first node and out over their last, so
        // they never appear or vanish abruptly mid-run.
        const fade = Math.min(
          1,
          packet.nodesLeft / 3,
          (PACKET_LIFE - packet.nodesLeft) / 1.5 + 0.2,
        );

        const tailX = x - dx * CELL * TRAIL_NODES;
        const tailY = y - dy * CELL * TRAIL_NODES;
        const trail = ctx.createLinearGradient(tailX, tailY, x, y);
        trail.addColorStop(0, "transparent");
        trail.addColorStop(1, colorsRef.current.signal);
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = fade * 0.55;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.fillStyle = colorsRef.current.signal;
        ctx.globalAlpha = fade;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }

      ctx.globalAlpha = 1;
    };

    let last = 0;
    const loop = (now: number) => {
      // Clamp dt so a backgrounded tab does not resume by teleporting every
      // packet across the grid in one frame.
      const dtSeconds = last ? Math.min((now - last) / 1000, MAX_FRAME_SECONDS) : 0;
      last = now;
      stepField(field, { dtSeconds, now, cols, rows });
      drawPackets(now);
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };

    const shouldAnimate = () => inViewport && !reduceMotion.matches && width >= MIN_ANIMATED_WIDTH;

    const render = () => {
      stop();
      if (shouldAnimate()) {
        frame = requestAnimationFrame(loop);
      } else {
        drawStaticFrame();
      }
    };

    const resize = () => {
      // Capped below the display's true DPR: this layer is a handful of 3px
      // marks, and on a 4K panel the difference is invisible while the
      // per-frame clear over the backing store is not.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width === 0 || height === 0) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL);
      rows = Math.ceil(height / CELL);
      // The grid changed shape, so positions from the old one are meaningless.
      field.packets = [];
      field.flashes = [];
      render();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    reduceMotion.addEventListener("change", render);
    // Lets the colour effect repaint after a theme flip. It matters only while
    // the field is showing the static frame; the running loop already re-reads
    // colorsRef every frame.
    redrawRef.current = render;
    resize();

    return () => {
      stop();
      observer.disconnect();
      reduceMotion.removeEventListener("change", render);
      redrawRef.current = () => {};
    };
  }, [inViewport]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/* The rules themselves are static, so they stay in CSS where the
          compositor handles them for free — and reusing <CanvasBackdrop> is what
          guarantees this grid and the dashboard's are the same grid. The canvas
          above it carries only what moves. */}
      <CanvasBackdrop className="opacity-60" />
      <canvas ref={canvasRef} className="relative" />
    </div>
  );
}
