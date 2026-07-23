import { Button, cn, RuleEdge, SignalField, signalFieldClass } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/brand")({
  component: BrandPage,
});

/** One downloadable asset: a ground, its display metadata, and the two files. */
type Asset = {
  variant: string;
  label: string;
  ground: "light" | "dark";
  svg: string;
  png: string;
};

type Manifest = {
  logo: Asset[];
  logomark: Asset[];
  zip: string;
};

/**
 * Trigger a download without leaving the page. The assets are same-origin
 * static files, so a bare anchor with `download` is enough; no fetch, no blob.
 */
function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = url.split("/").pop() ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * A single asset tile: the artwork on its intended ground, with SVG and PNG
 * download controls that surface on hover and, importantly, on keyboard focus.
 * Neon's version reveals on hover only, which strands keyboard users; the
 * controls here are always in the tab order and become visible when focused.
 */
function AssetTile({ asset }: { asset: Asset }) {
  return (
    <figure className="group relative flex flex-col">
      <div
        className={cn(
          "flex min-h-44 items-center justify-center p-8",
          asset.ground === "dark" ? "bg-[oklch(0.145_0_0)]" : "bg-[oklch(1_0_0)]",
          // A light-on-light or dark-on-dark tile needs an edge or it floats in
          // the page; the hairline gives it one without a heavy border.
          "ring-1 ring-inset ring-border",
        )}
      >
        {/* The asset is decorative here — its label names it in the caption —
            so the <img> alt stays empty rather than repeating "Skillist". */}
        <img src={asset.svg} alt="" className="h-12 w-auto" />
      </div>
      <figcaption className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{asset.label}</span>
        <span className="flex items-center gap-1.5">
          {(["svg", "png"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => download(asset[fmt])}
              className={cn(
                "font-mono text-xs text-muted-foreground uppercase",
                "border border-border px-2 py-1 transition-colors",
                "hover:bg-accent hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              {fmt}
            </button>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * A ruled row of colour tokens. These are the exact OKLCH values from
 * DESIGN.md; the swatch is the literal token so the page can never quote a
 * colour it does not use.
 */
const COLORS: { name: string; token: string; value: string; note: string }[] = [
  {
    name: "Ink",
    token: "--foreground",
    value: "oklch(0.145 0 0)",
    note: "Primary text and the wordmark",
  },
  { name: "Paper", token: "--background", value: "oklch(1 0 0)", note: "Light surface" },
  {
    name: "Signal",
    token: "--signal",
    value: "oklch(0.52 0.21 293)",
    note: "Live / realtime, ≤10%",
  },
  {
    name: "Destructive",
    token: "--destructive",
    value: "oklch(0.577 0.245 27.325)",
    note: "Failure only",
  },
];

/**
 * The clear-space diagram, in the ground that matches the page theme.
 *
 * The safe-area SVGs bake the artwork in their variant's ink — near-black for
 * `light`, paper for `dark` — so a single image would go low-contrast in one
 * theme. Rendering both and swapping with `dark:` (the same
 * pattern the docs logo uses) keeps the mark legible either way; the guide
 * strokes are a neutral grey that reads on both grounds.
 */
function SafeAreaDiagram({ kind, alt }: { kind: "logo" | "logomark"; alt: string }) {
  return (
    <>
      <img
        src={`/brand/skillist-${kind}-light-safe-area.svg`}
        alt={alt}
        className="h-40 w-auto ring-1 ring-border dark:hidden"
      />
      <img
        src={`/brand/skillist-${kind}-dark-safe-area.svg`}
        alt={alt}
        className="hidden h-40 w-auto ring-1 ring-border dark:block"
      />
    </>
  );
}

function SectionHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-headline text-foreground">{title}</h2>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function BrandPage() {
  const { data } = useQuery({
    queryKey: ["brand-manifest"],
    queryFn: () => fetch("/brand/manifest.json").then((r) => r.json() as Promise<Manifest>),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <div className="flex flex-col">
      {/* Hero — the same dark band as the landing, so the brand page opens on
          the identity it is about to document. (Dark Hero Exception, DESIGN.md
          §2.) The negative margins cancel main's padding for the full-bleed
          band; the inner wrapper restores the inset. */}
      <section className="dark panel-noise relative -mx-4 -mt-8 overflow-hidden border-b border-border bg-background text-foreground md:-mx-6">
        <SignalField className={signalFieldClass} />
        <div className="px-4 md:px-6">
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 px-1 py-20 md:py-24">
            <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <span className="inline-flex size-1.5 bg-signal" aria-hidden />
              Brand
            </span>
            <h1 className="text-balance text-hero text-foreground">Assets and guidelines</h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              The Skillist wordmark, the S stamp, colours, and the rules for using them. The logo is
              a single ink; pick the variant cut for the ground it sits on.
            </p>
            <Button
              size="lg"
              className="mt-2"
              onClick={() => download(data?.zip ?? "/brand/skillist-brand-assets.zip")}
            >
              Download brand pack
            </Button>
          </div>
        </div>
      </section>

      {/* Logo */}
      <section className="mx-auto w-full max-w-6xl px-1 py-16">
        <SectionHead title="Logo">
          The logo is the wordmark alone: SKILLIST in Inter SemiBold capitals at +0.14em tracking,
          the same voice the product labels its controls and readouts with. Do not recolour it,
          re-space it, set it in another weight or case, or add a symbol beside it.
        </SectionHead>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {data?.logo.map((asset) => (
            <AssetTile key={asset.variant} asset={asset} />
          ))}
        </div>
      </section>

      {/* Logomark */}
      <section className="mx-auto w-full max-w-6xl px-1 pb-16">
        <SectionHead title="Logomark">
          The S stamp, for the places a word will not fit: an avatar, a favicon, an app icon. The
          Bold S sits in a filled square that inverts with the ground. Everywhere there is room for
          the wordmark, use the wordmark instead.
        </SectionHead>
        <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {data?.logomark.map((asset) => (
            <AssetTile key={asset.variant} asset={asset} />
          ))}
        </div>
      </section>

      {/* Clear space */}
      <section className="mx-auto w-full max-w-6xl px-1 pb-16">
        <SectionHead title="Clear space">
          Keep a margin of half the cap height clear on every side, and half the tile side around
          the stamp. The margin scales with the type, so it holds at any size.
        </SectionHead>
        <div className="mt-8 flex flex-wrap items-center gap-8">
          <SafeAreaDiagram
            kind="logomark"
            alt="The Skillist stamp with its clear space marked: half the tile side on every side."
          />
          <SafeAreaDiagram kind="logo" alt="The Skillist logo with its clear space marked." />
        </div>
      </section>

      {/* Colour */}
      <section className="mx-auto w-full max-w-6xl px-1 pb-20">
        <SectionHead title="Colour">
          Monochrome ink carries the system. Two chromatic voices, each meaning exactly one thing:
          the signal violet for live and realtime state, destructive red for failure. Every value is
          OKLCH.
        </SectionHead>
        <div className="relative mt-8 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <RuleEdge />
          {COLORS.map((c) => (
            <div key={c.name} className="flex flex-col gap-3 bg-background p-5">
              <span
                className="h-16 w-full ring-1 ring-inset ring-border"
                style={{ background: c.value }}
                aria-hidden
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.value}</span>
                <span className="text-xs text-muted-foreground">{c.note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
