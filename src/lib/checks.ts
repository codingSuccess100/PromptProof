import type { CheckCategory, CheckKind, CheckResult, CheckSpec, Task } from "./types";

export const SCORER_VERSION = "2026-11-14.3";

/**
 * Text is normalized the same way before every check, so a curly apostrophe or a
 * non-breaking space cannot decide a result:
 * Unicode compatibility form, straight quotes, plain hyphens, ordinary spaces.
 * Accents are kept. "Hôpital" and "Hopital" are different strings unless the user approves both.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00a0\u2000-\u200a\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "");
}

/** Loose form used only to detect a near miss: no accents, no punctuation, no case. Never used to pass a check. */
export function foldLoose(text: string): string {
  return normalizeText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Finds the text in an answer that matches a literal once accents, punctuation, and case are ignored.
 * Returns it exactly as the answer wrote it ("L'H\u00f4pital" for the literal "LHopital"), or null.
 */
export function findVariant(output: string, literal: string): string | null {
  const target = foldLoose(literal);
  if (target.length < 3) return null;
  const text = normalizeText(output);
  const starts = [0, ...Array.from(text.matchAll(/[\s(\["]+/g)).map((m) => (m.index ?? 0) + m[0].length)];
  for (const start of starts) {
    for (let end = start + 1; end <= Math.min(text.length, start + literal.length * 3 + 8); end++) {
      const folded = foldLoose(text.slice(start, end));
      if (folded.length > target.length || !target.startsWith(folded)) break;
      if (folded === target) return text.slice(start, end);
    }
  }
  return null;
}

export function categoryOf(kind: CheckKind, literal = false): CheckCategory {
  if (kind === "maxWords") return "length";
  if (kind === "noListFormatting" || kind === "numberedItemsExactly" || kind === "onlyNumberedLines") return "format";
  return literal ? "exact_text" : "text_pattern";
}

// Deterministic checks only. No model is consulted here.

const NUMBERED_LINE = /^\s*\d+[.)]\s+\S/;
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADER = /^\s*#{1,6}\s/;

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]*?(?:[.!?](?=\s|$)|\n|$)/);
  return (match ? match[0] : trimmed).trim();
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function regex(spec: CheckSpec, extraFlags = ""): RegExp {
  const flags = (spec.flags ?? "i") + extraFlags;
  return new RegExp(spec.pattern ?? "", Array.from(new Set(flags.split(""))).join(""));
}

export function runCheck(spec: CheckSpec, rawOutput: string): CheckResult {
  const output = normalizeText(rawOutput);
  const base = { id: spec.id, label: spec.label, category: categoryOf(spec.kind, !!spec.literals) };
  // An empty answer meets nothing, including "must not mention" rules.
  if (output.trim().length === 0) return { ...base, pass: false, detail: "the answer was empty" };
  switch (spec.kind) {
    case "maxWords": {
      const words = countWords(output);
      return { ...base, pass: words > 0 && words <= (spec.value ?? 0), detail: `${words} words` };
    }
    case "matches": {
      const found = output.match(regex(spec));
      return { ...base, pass: !!found, detail: found ? `found "${found[0]}"` : "not found" };
    }
    case "notMatches": {
      const found = output.match(regex(spec));
      return { ...base, pass: !found, detail: found ? `found "${found[0]}"` : "none found" };
    }
    case "firstSentenceMatches": {
      // Judge the first sentence of real content: skip a lead-in line such as
      // "Here is a summary:" and ignore a list marker in front of the sentence.
      const contentLines = nonEmptyLines(output);
      while (contentLines.length > 1 && /:\s*$/.test(contentLines[0])) contentLines.shift();
      const sentence = firstSentence(contentLines.join("\n").replace(LIST_MARKER, ""));
      const found = sentence.match(regex(spec));
      const preview = sentence.length > 70 ? `${sentence.slice(0, 67)}...` : sentence;
      return { ...base, pass: !!found, detail: `first sentence: "${preview}"` };
    }
    case "mentionsFirst": {
      // The narrow mechanical test behind "X is the first issue named":
      // the first sentence names X, nothing from the rival subject comes before it, and it is not negated.
      const contentLines = nonEmptyLines(output);
      while (contentLines.length > 1 && /:\s*$/.test(contentLines[0])) contentLines.shift();
      const body = contentLines.join("\n").replace(LIST_MARKER, "");
      const sentence = firstSentence(body);
      const preview = sentence.length > 70 ? `${sentence.slice(0, 67)}...` : sentence;
      const hit = sentence.match(regex(spec));
      if (!hit) return { ...base, pass: false, detail: `not named in the first sentence: "${preview}"` };
      const before = sentence.slice(0, hit.index ?? 0);
      if (/\b(no|not|never|without|few|zero|aside from|apart from|other than|rather than)\b[^.,;]{0,30}$/i.test(before)) {
        return { ...base, pass: false, detail: `named in the first sentence, but negated or set aside: "${preview}"` };
      }
      const rival = spec.rival ? before.match(new RegExp(spec.rival, "i")) : null;
      if (rival) return { ...base, pass: false, detail: `"${rival[0]}" comes before "${hit[0]}" in the first sentence: "${preview}"` };
      return { ...base, pass: true, detail: `first sentence: "${preview}"` };
    }
    case "startsWith": {
      const found = output.trimStart().match(regex(spec));
      return { ...base, pass: !!found, detail: found ? "present at the start" : "not at the start" };
    }
    case "noListFormatting": {
      const lines = nonEmptyLines(output);
      const listLines = lines.filter((line) => LIST_MARKER.test(line) || HEADER.test(line)).length;
      const paragraphs = output
        .trim()
        .split(/\n\s*\n/)
        .filter((p) => p.trim().length > 0).length;
      const pass = output.trim().length > 0 && listLines === 0 && paragraphs <= 1;
      const detail =
        listLines > 0 ? `${listLines} list or heading lines` : `${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}`;
      return { ...base, pass, detail };
    }
    case "numberedItemsExactly": {
      const count = nonEmptyLines(output).filter((line) => NUMBERED_LINE.test(line)).length;
      return { ...base, pass: count === (spec.value ?? 0), detail: `${count} numbered items` };
    }
    case "onlyNumberedLines": {
      const lines = nonEmptyLines(output);
      const other = lines.filter((line) => !NUMBERED_LINE.test(line)).length;
      const pass = lines.length > 0 && other === 0;
      return { ...base, pass, detail: other === 0 ? "list only" : `${other} lines outside the list` };
    }
    case "minMatches": {
      const count = (output.match(regex(spec, "g")) ?? []).length;
      return { ...base, pass: count >= (spec.value ?? 1), detail: `${count} found` };
    }
    default: {
      const never: never = spec.kind;
      throw new Error(`Unknown check kind: ${String(never)}`);
    }
  }
}

export function scoreOutput(task: Task, output: string): { checks: CheckResult[]; score: number; total: number } {
  const checks = task.checks.map((spec) => runCheck(spec, output));
  return { checks, score: checks.filter((c) => c.pass).length, total: checks.length };
}
