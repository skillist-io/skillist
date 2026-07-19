// Minimal Vite env typing for shared components consumed by Vite apps
// (avoids a hard `vite` devDependency just for `import.meta.env`). Merges with
// each app's own `vite/client` types when compiled in the app.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly [key: `VITE_${string}`]: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
