import katex from "katex";
import type { ReactNode } from "react";

// A small Markdown renderer for model answers, with LaTeX math.
// Text, emphasis, lists, and code are built as React elements, so nothing in an answer can run.
// Math is the one exception: it is rendered by KaTeX with trust off, which outputs only its own
// markup. This only changes how the answer is displayed. Checks always run on the raw text.

function math(tex: string, display: boolean, key: string): ReactNode {
  try {
    const html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: true, trust: false, strict: "ignore", output: "html" });
    return display ? <div key={key} className="math-block" dangerouslySetInnerHTML={{ __html: html }} /> : <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // Not valid LaTeX: show it as written.
    return display ? <pre key={key}>{tex}</pre> : <code key={key}>{tex}</code>;
  }
}

// $...$ is only treated as math when it looks like math, so "$1,200 and $40k" stays as money.
const LOOKS_LIKE_MATH = /[\\^_{}=]|[a-zA-Z]\s*[+\-*/<>]\s*[a-zA-Z0-9]/;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\$\$[^$]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*|\b_[^_\n]+_\b)/g;
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    const token = match[0];
    const key = `${keyBase}-${n++}`;
    let node: ReactNode;
    if (token.startsWith("$$") || token.startsWith("\\[")) node = math(token.slice(2, -2), false, key);
    else if (token.startsWith("\\(")) node = math(token.slice(2, -2), false, key);
    else if (token.startsWith("$")) {
      const body = token.slice(1, -1);
      if (!LOOKS_LIKE_MATH.test(body) || /^\s|\s$/.test(body)) continue;
      node = math(body, false, key);
    } else if (token.startsWith("**")) node = <strong key={key}>{token.slice(2, -2)}</strong>;
    else if (token.startsWith("`")) node = <code key={key}>{token.slice(1, -1)}</code>;
    else node = <em key={key}>{token.slice(1, -1)}</em>;
    if (at > last) out.push(text.slice(last, at));
    out.push(node);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const key = `b${i}`;
    if (trimmed === "") {
      i++;
    } else if (trimmed.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key}>{code.join("\n")}</pre>);
    } else if (trimmed.startsWith("$$") || trimmed.startsWith("\\[")) {
      const close = trimmed.startsWith("$$") ? "$$" : "\\]";
      let body = trimmed.slice(2);
      if (body.includes(close)) {
        body = body.slice(0, body.indexOf(close));
        i++;
      } else {
        const tex = [body];
        i++;
        while (i < lines.length && !lines[i].includes(close)) tex.push(lines[i++]);
        if (i < lines.length) tex.push(lines[i].slice(0, lines[i].indexOf(close)));
        i++;
        body = tex.join("\n");
      }
      blocks.push(math(body, true, key));
    } else if (/^\s*#{1,6}\s+/.test(line)) {
      blocks.push(<p key={key} className="md-heading">{inline(line.replace(/^\s*#{1,6}\s+/, ""), key)}</p>);
      i++;
    } else if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
    } else if (LIST.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && LIST.test(lines[i])) {
        items.push(<li key={`${key}-${i}`}>{inline(lines[i].replace(LIST, ""), `${key}-${i}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^\s*(?:#{1,6}\s|[-*\u2022]\s|\d+[.)]\s|```|\$\$|\\\[)/.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
