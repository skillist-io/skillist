// Shared Skillist UI — consumed as source by apps/web (marketing) and
// apps/console (product). Barrel export; add shared components as they migrate.

export * from "./components/canvas-backdrop";
export * from "./components/copy-button";
export * from "./components/frontmatter-card";
export * from "./components/highlight";
export * from "./components/markdown-view";
export * from "./components/mini-bar-chart";
export * from "./components/query-error";
export * from "./components/route-error";
export * from "./components/score-readout";
export * from "./components/skill-analytics-chart";
export * from "./components/skill-readme";
export * from "./components/skill-run-card";
export * from "./components/skill-run-history";
export * from "./components/skillist-logo";
export * from "./components/theme-provider";
export * from "./components/theme-toggle";
export * from "./hooks/use-mobile";
export * from "./hooks/use-skill-realtime";
// Shared clients + composite components (exported after the primitives so
// intra-package barrel imports resolve in evaluation order).
export * from "./lib/api";
export * from "./lib/api-url";
export * from "./lib/auth-client";
export * from "./lib/client-api-base";
export * from "./lib/query-cache";
export * from "./lib/theme";
export * from "./lib/urls";
export * from "./ui/avatar";
export * from "./ui/badge";
export * from "./ui/breadcrumb";
export * from "./ui/button";
export * from "./ui/card";
export * from "./ui/collapsible";
export * from "./ui/confirm-dialog";
export * from "./ui/dialog";
export * from "./ui/dropdown-menu";
export * from "./ui/field";
export * from "./ui/input";
export * from "./ui/label";
export * from "./ui/native-select";
export * from "./ui/page-title";
export * from "./ui/popover";
export * from "./ui/separator";
export * from "./ui/sheet";
export * from "./ui/sidebar";
export * from "./ui/skeleton";
export * from "./ui/switch";
export * from "./ui/textarea";
export * from "./ui/tooltip";
export * from "./utils";
