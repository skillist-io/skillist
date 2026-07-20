import { binaryAssetMimeType, isBinaryAssetPath } from "@skillist/skill-format";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "..";
import { highlight, languageForFence } from "./highlight";

export type MarkdownViewProps = {
  markdown: string;
  className?: string;
  /** Bundle file map — relative links that resolve to a bundle file open in place. */
  files?: Record<string, string>;
  onOpenFile?: (path: string) => void;
};

function resolveBundlePath(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href.startsWith("/") || href.startsWith("#")) {
    return null;
  }
  const clean = href.replace(/^\.\//, "").split(/[?#]/)[0] ?? "";
  return clean.length > 0 ? clean : null;
}

export default function MarkdownView({
  markdown,
  className,
  files,
  onOpenFile,
}: MarkdownViewProps) {
  return (
    <div className={cn("prose prose-neutral dark:prose-invert max-w-none prose-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const bundlePath = href ? resolveBundlePath(href) : null;
            const inBundle = !!bundlePath && !!files && files[bundlePath] !== undefined;
            if (bundlePath && inBundle && onOpenFile) {
              return (
                <button
                  type="button"
                  onClick={() => onOpenFile(bundlePath)}
                  className="cursor-pointer font-medium underline underline-offset-2"
                >
                  {children}
                </button>
              );
            }
            // The file ships in the bundle but this context has no viewer to open
            // it in. Its href is bundle-relative, so an <a> would resolve against
            // the page URL and 404 — name the file instead of linking nowhere.
            if (inBundle) {
              return <code>{children}</code>;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const bundlePath = typeof src === "string" ? resolveBundlePath(src) : null;
            if (bundlePath) {
              const content = files?.[bundlePath];
              if (content !== undefined && isBinaryAssetPath(bundlePath)) {
                return (
                  <img
                    src={`data:${binaryAssetMimeType(bundlePath)};base64,${content}`}
                    alt={alt ?? bundlePath}
                    className="max-w-full"
                  />
                );
              }
              return <span className="text-xs text-muted-foreground">[image: {bundlePath}]</span>;
            }
            return <img src={src} alt={alt ?? ""} className="max-w-full" />;
          },
          code: ({ className, children, ...props }) => {
            const fenceLang = /language-(\S+)/.exec(className ?? "")?.[1];
            if (!fenceLang) {
              // Inline `code` span — no fence language, no highlighting.
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            const source = (Array.isArray(children) ? children.join("") : String(children)).replace(
              /\n$/,
              "",
            );
            return (
              <code
                className={className}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: output of our own escaping tokenizer
                dangerouslySetInnerHTML={{ __html: highlight(source, languageForFence(fenceLang)) }}
              />
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
