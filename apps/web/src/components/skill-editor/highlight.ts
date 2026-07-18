// Hand-rolled, line-based syntax highlighting for the bundle editor overlay.
// Coarse by design: readability-grade tokens, not a grammar. Output is
// escaped HTML using <span class="tok-*"> classes themed in index.css.

export type Language = "markdown" | "yaml" | "python" | "shell" | "javascript" | "json" | "plain";

export function languageForPath(path: string): Language {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".js") || lower.endsWith(".ts")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  return "plain";
}

const FENCE_LANG_ALIASES: Record<string, Language> = {
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  python: "python",
  sh: "shell",
  shell: "shell",
  bash: "shell",
  zsh: "shell",
  js: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  javascript: "javascript",
  typescript: "javascript",
  json: "json",
  jsonc: "json",
};

/** Maps a fenced-code-block info string (e.g. "py", "ts", "yaml") to a highlighter language. */
export function languageForFence(info: string | undefined): Language {
  if (!info) return "plain";
  return FENCE_LANG_ALIASES[info.toLowerCase()] ?? "plain";
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

type Rule = { re: RegExp; cls: string | null };

function tokenizeLine(line: string, rules: Rule[]): string {
  let out = "";
  let pos = 0;
  while (pos < line.length) {
    let matched = false;
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const match = rule.re.exec(line);
      if (match && match[0].length > 0) {
        out += rule.cls ? span(rule.cls, match[0]) : escapeHtml(match[0]);
        pos += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += escapeHtml(line[pos] ?? "");
      pos += 1;
    }
  }
  return out;
}

const YAML_VALUE_RULES: Rule[] = [
  { re: /#.*$/y, cls: "tok-comment" },
  { re: /"(?:\\.|[^"\\])*"|'(?:[^']|'')*'/y, cls: "tok-string" },
  { re: /\b(?:true|false|null|yes|no)\b/y, cls: "tok-keyword" },
  { re: /-?\d[\d_]*(?:\.\d+)?\b/y, cls: "tok-number" },
  { re: /[A-Za-z][\w./-]*/y, cls: null },
];

function highlightYamlLine(line: string): string {
  const key = line.match(/^(\s*(?:-\s+)?)([\w.-]+)(\s*:)(\s|$)/);
  if (key) {
    const consumed = key[0].length;
    return (
      escapeHtml(key[1] ?? "") +
      span("tok-property", key[2] ?? "") +
      span("tok-punctuation", key[3] ?? "") +
      escapeHtml(key[4] ?? "") +
      tokenizeLine(line.slice(consumed), YAML_VALUE_RULES)
    );
  }
  return tokenizeLine(line, YAML_VALUE_RULES);
}

const MARKDOWN_INLINE_RULES: Rule[] = [
  { re: /`[^`]+`/y, cls: "tok-string" },
  { re: /!?\[[^\]]*\]\([^)]*\)/y, cls: "tok-link" },
  { re: /(\*\*|__)(?=\S)[\s\S]*?\S\1/y, cls: null },
  { re: /[*_~]+/y, cls: "tok-punctuation" },
  { re: /[A-Za-z0-9]+/y, cls: null },
];

const PYTHON_RULES: Rule[] = [
  { re: /#.*$/y, cls: "tok-comment" },
  { re: /(?:[rbfu]{0,2})(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/y, cls: "tok-string" },
  {
    re: /\b(?:def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|assert|in|is|not|and|or|None|True|False|async|await|match|case)\b/y,
    cls: "tok-keyword",
  },
  { re: /^\s*@[\w.]+/y, cls: "tok-property" },
  { re: /\b\d[\d_]*(?:\.\d+)?\b/y, cls: "tok-number" },
  { re: /[A-Za-z_][\w]*/y, cls: null },
];

const SHELL_RULES: Rule[] = [
  { re: /#.*$/y, cls: "tok-comment" },
  { re: /"(?:\\.|[^"\\])*"|'[^']*'/y, cls: "tok-string" },
  { re: /\$\{?[A-Za-z_][\w]*\}?|\$[\d@*?#]/y, cls: "tok-property" },
  {
    re: /\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|local|export|return|set|echo|exit|source|trap)\b/y,
    cls: "tok-keyword",
  },
  { re: /\b\d+\b/y, cls: "tok-number" },
  { re: /[A-Za-z_][\w]*/y, cls: null },
];

const JS_RULES: Rule[] = [
  { re: /\/\/.*$/y, cls: "tok-comment" },
  { re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y, cls: "tok-string" },
  {
    re: /\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|default|new|async|await|try|catch|finally|throw|typeof|instanceof|extends|switch|case|break|continue|null|undefined|true|false|this|of|in|void|delete|yield|static|get|set)\b/y,
    cls: "tok-keyword",
  },
  { re: /\b\d[\d_]*(?:\.\d+)?\b/y, cls: "tok-number" },
  { re: /[A-Za-z_$][\w$]*/y, cls: null },
];

const JSON_RULES: Rule[] = [
  { re: /"(?:\\.|[^"\\])*"(?=\s*:)/y, cls: "tok-property" },
  { re: /"(?:\\.|[^"\\])*"/y, cls: "tok-string" },
  { re: /\b(?:true|false|null)\b/y, cls: "tok-keyword" },
  { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, cls: "tok-number" },
  { re: /[{}[\],:]/y, cls: "tok-punctuation" },
];

function highlightMarkdown(lines: string[]): string[] {
  let state: "normal" | "frontmatter" | "fence" = "normal";
  let fenceMarker = "";
  return lines.map((line, index) => {
    if (index === 0 && line.trim() === "---") {
      state = "frontmatter";
      return span("tok-fence", line);
    }
    if (state === "frontmatter") {
      if (line.trim() === "---") {
        state = "normal";
        return span("tok-fence", line);
      }
      return highlightYamlLine(line);
    }
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (state === "fence") {
        if ((fence[2] ?? "").startsWith(fenceMarker[0] ?? "`")) state = "normal";
        return span("tok-fence", line);
      }
      state = "fence";
      fenceMarker = fence[2] ?? "```";
      return (
        escapeHtml(fence[1] ?? "") +
        span("tok-fence", fence[2] ?? "") +
        span("tok-keyword", fence[3] ?? "")
      );
    }
    if (state === "fence") return escapeHtml(line);
    if (/^#{1,6}\s/.test(line)) return span("tok-heading", line);
    if (/^\s*>/.test(line)) return span("tok-comment", line);
    const list = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/);
    if (list) {
      return (
        escapeHtml(list[1] ?? "") +
        span("tok-punctuation", list[2] ?? "") +
        escapeHtml(list[3] ?? "") +
        tokenizeLine(list[4] ?? "", MARKDOWN_INLINE_RULES)
      );
    }
    return tokenizeLine(line, MARKDOWN_INLINE_RULES);
  });
}

function highlightPython(lines: string[]): string[] {
  let inTriple: '"""' | "'''" | null = null;
  return lines.map((line) => {
    if (inTriple) {
      const end = line.indexOf(inTriple);
      if (end === -1) return span("tok-string", line);
      const closed = line.slice(0, end + 3);
      inTriple = null;
      return span("tok-string", closed) + tokenizeLine(line.slice(closed.length), PYTHON_RULES);
    }
    const first = line.match(/"""|'''/);
    if (first) {
      const marker = first[0] as '"""' | "'''";
      const occurrences = line.split(marker).length - 1;
      if (occurrences % 2 === 1) {
        inTriple = marker;
        const before = line.slice(0, first.index ?? 0);
        return tokenizeLine(before, PYTHON_RULES) + span("tok-string", line.slice(before.length));
      }
    }
    return tokenizeLine(line, PYTHON_RULES);
  });
}

function highlightJs(lines: string[]): string[] {
  let inBlockComment = false;
  return lines.map((line) => {
    let out = "";
    let rest = line;
    if (inBlockComment) {
      const end = rest.indexOf("*/");
      if (end === -1) return span("tok-comment", line);
      out += span("tok-comment", rest.slice(0, end + 2));
      rest = rest.slice(end + 2);
      inBlockComment = false;
    }
    const start = rest.indexOf("/*");
    if (start !== -1 && !rest.slice(0, start).includes("//")) {
      const end = rest.indexOf("*/", start + 2);
      if (end === -1) {
        inBlockComment = true;
        return (
          out +
          tokenizeLine(rest.slice(0, start), JS_RULES) +
          span("tok-comment", rest.slice(start))
        );
      }
      return (
        out +
        tokenizeLine(rest.slice(0, start), JS_RULES) +
        span("tok-comment", rest.slice(start, end + 2)) +
        tokenizeLine(rest.slice(end + 2), JS_RULES)
      );
    }
    return out + tokenizeLine(rest, JS_RULES);
  });
}

export function highlight(code: string, lang: Language): string {
  const lines = code.split("\n");
  switch (lang) {
    case "markdown":
      return highlightMarkdown(lines).join("\n");
    case "yaml":
      return lines.map(highlightYamlLine).join("\n");
    case "python":
      return highlightPython(lines).join("\n");
    case "shell":
      return lines.map((line) => tokenizeLine(line, SHELL_RULES)).join("\n");
    case "javascript":
      return highlightJs(lines).join("\n");
    case "json":
      return lines.map((line) => tokenizeLine(line, JSON_RULES)).join("\n");
    default:
      return escapeHtml(code);
  }
}
