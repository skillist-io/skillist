import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
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
            if (bundlePath && files && files[bundlePath] !== undefined && onOpenFile) {
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
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const bundlePath = typeof src === "string" ? resolveBundlePath(src) : null;
            if (bundlePath) {
              // Bundle-relative images have no servable URL inside the editor.
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
