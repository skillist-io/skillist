/**
 * Structural stand-in for Vite's Plugin type.
 *
 * packages/ui is consumed as source with no build step and deliberately carries
 * no build-tool dependencies, so importing `vite` here (or adding @types/node
 * for `process`) would pull tooling types into every consumer. The shape is
 * small and stable enough to state directly; Vite accepts it structurally.
 */
type IndexHtmlPlugin = {
  name: string;
  transformIndexHtml: {
    order: "pre";
    handler: (html: string, ctx: { server?: unknown }) => string;
  };
};

type EnvLike = Record<string, string | undefined>;

/**
 * Injects the Google Tag Manager container into index.html at build time.
 *
 * Guarded on VITE_GTM_ID: the variable is only set in the CI deploy jobs, so
 * dev and preview builds never load GTM and never pollute the property. It also
 * means a local `pnpm build` produces a tag-free bundle.
 *
 * The inline snippet sets Consent Mode v2 defaults BEFORE the container loads.
 * That ordering is the whole point — a default set after GTM initialises is too
 * late, and analytics_storage would have been used already. Defaults are denied
 * everywhere rather than only in the EEA: simpler to reason about, and this
 * audience is disproportionately privacy-attentive.
 *
 * Ad-related signals are permanently denied. Skillist does not advertise, and
 * enabling them would turn an analytics decision into an advertising one with a
 * materially higher compliance bar for no benefit.
 */
export function gtmPlugin(
  // Injected so this stays testable without a `process` global. Vite configs
  // run in Node, so the default picks up the CI-provided value.
  env: EnvLike = (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {},
): IndexHtmlPlugin {
  return {
    name: "skillist-gtm",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const containerId = ctx.server ? undefined : env.VITE_GTM_ID;
        if (!containerId) return html;

        const bootstrap = `
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      // Denied until the visitor explicitly grants it. wait_for_update gives the
      // banner a moment to replay a stored choice before tags decide.
      gtag('consent', 'default', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
        wait_for_update: 500
      });
    </script>
    <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','${containerId}');</script>`;

        const noscript = `
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

        return html
          .replace("</head>", `${bootstrap}\n  </head>`)
          .replace("<body>", `<body>${noscript}`);
      },
    },
  };
}
