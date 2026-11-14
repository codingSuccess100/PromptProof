import { getTask } from "./tasks";
import { CUSTOM_TASK_ID } from "./types";
import type { CheckSpec, CustomCheck, CustomCheckKind, CustomTaskInput, Task } from "./types";

// Turns a user's own requirements into the same rule-based checks the practice scenarios use.
// User text is always escaped and matched literally. No user-supplied regex ever runs.

export const MAX_CUSTOM_CHECKS = 8;
export const MAX_MATERIAL_CHARS = 6000;
export const MAX_CHECK_TEXT = 120;

const KINDS: CustomCheckKind[] = [
  "maxWords",
  "includes",
  "excludes",
  "startsWith",
  "singleParagraph",
  "numberedItems",
  "listOnly",
];
const NEEDS_TEXT: CustomCheckKind[] = ["includes", "excludes", "startsWith"];
const NEEDS_VALUE: CustomCheckKind[] = ["maxWords", "numberedItems"];

function escapeRegex(text: string): string {
  return text
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

/** Returns a cleaned check, or null if it is not usable. */
export function cleanCheck(raw: unknown): CustomCheck | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, text, value } = raw as { kind?: unknown; text?: unknown; value?: unknown };
  if (typeof kind !== "string" || !KINDS.includes(kind as CustomCheckKind)) return null;
  const k = kind as CustomCheckKind;
  if (NEEDS_TEXT.includes(k)) {
    if (typeof text !== "string") return null;
    const t = text.trim().replace(/\s+/g, " ");
    if (t.length === 0 || t.length > MAX_CHECK_TEXT) return null;
    return { kind: k, text: t };
  }
  if (NEEDS_VALUE.includes(k)) {
    const n = Math.floor(Number(value));
    const max = k === "maxWords" ? 2000 : 50;
    if (!Number.isFinite(n) || n < 1 || n > max) return null;
    return { kind: k, value: n };
  }
  return { kind: k };
}

/** Plain-language label for a check. Shared by the server and the editor in the browser. */
export function describeCheck(check: CustomCheck): string {
  switch (check.kind) {
    case "maxWords":
      return `${check.value} words or fewer`;
    case "includes":
      return `Includes "${check.text}"`;
    case "excludes":
      return `Does not mention "${check.text}"`;
    case "startsWith":
      return `Starts with "${check.text}"`;
    case "singleParagraph":
      return "One plain paragraph, no bullets";
    case "numberedItems":
      return `Numbered list with exactly ${check.value} items`;
    case "listOnly":
      return "A numbered list and nothing else";
  }
}

function toSpec(check: CustomCheck, index: number): CheckSpec {
  const id = `c${index + 1}`;
  const label = describeCheck(check);
  const text = check.text ?? "";
  const esc = escapeRegex(text);
  const n = check.value ?? 0;
  switch (check.kind) {
    case "maxWords":
      return {
        id,
        label,
        kind: "maxWords",
        value: n,
        ghostClause: `Use ${n} words or fewer.`,
        promptCue: `\\b${n}\\s*-?\\s*words?\\b|\\bwords?\\b[^.]*\\b${n}\\b`,
      };
    case "includes":
      return { id, label, kind: "matches", pattern: esc, ghostClause: `Include "${text}".`, promptCue: esc };
    case "excludes":
      return {
        id,
        label,
        kind: "notMatches",
        pattern: esc,
        ghostClause: `Do not mention "${text}".`,
        promptCue: `(no|not|without|avoid|leave out|exclude|never|omit)[^.]*${esc}`,
      };
    case "startsWith":
      return {
        id,
        label,
        kind: "startsWith",
        pattern: `^\\W*${esc}`,
        ghostClause: `Start with "${text}".`,
        promptCue: `(start|begin|open)[^.]*${esc}`,
      };
    case "singleParagraph":
      return {
        id,
        label,
        kind: "noListFormatting",
        ghostClause: "Write one plain paragraph with no bullet points.",
        promptCue: "(one|single|a)\\s+(plain\\s+|short\\s+)?paragraph|no\\s+(bullet|list)|without\\s+(bullet|list)",
      };
    case "numberedItems":
      return {
        id,
        label,
        kind: "numberedItemsExactly",
        value: n,
        ghostClause: `Use a numbered list with exactly ${n} items.`,
        promptCue: `numbered[^.]*\\b${n}\\b|\\b${n}\\b[^.]*numbered|exactly\\s+${n}\\b`,
      };
    case "listOnly":
      return {
        id,
        label,
        kind: "onlyNumberedLines",
        ghostClause: "Output a numbered list and nothing else, with no intro or closing line.",
        promptCue: "nothing else|only the list|list only|no intro",
      };
  }
}

export function buildCustomTask(input: unknown): { task: Task } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Add at least one requirement for your own prompt." };
  const { material, checks } = input as Partial<CustomTaskInput>;
  const text = typeof material === "string" ? material : "";
  if (text.length > MAX_MATERIAL_CHARS) return { error: `Keep the material under ${MAX_MATERIAL_CHARS} characters.` };
  if (!Array.isArray(checks) || checks.length === 0) {
    return { error: "Add at least one requirement, so there is something objective to measure." };
  }
  if (checks.length > MAX_CUSTOM_CHECKS) return { error: `Use at most ${MAX_CUSTOM_CHECKS} requirements.` };
  const cleaned = checks.map(cleanCheck);
  if (cleaned.some((c) => c === null)) return { error: "One of the requirements is incomplete. Fill it in or remove it." };
  return {
    task: {
      id: CUSTOM_TASK_ID,
      title: "Your own prompt",
      blurb: "Debug a prompt you actually use.",
      situationCard: [],
      sourceMaterial: text.trim(),
      checks: (cleaned as CustomCheck[]).map(toSpec),
    },
  };
}

/** Finds a practice scenario by id, or builds the user's own task. */
export function resolveTask(taskId: unknown, custom: unknown): { task: Task } | { error: string; status: number } {
  if (taskId === CUSTOM_TASK_ID) {
    const built = buildCustomTask(custom);
    return "task" in built ? built : { error: built.error, status: 400 };
  }
  const task = typeof taskId === "string" ? getTask(taskId) : undefined;
  return task ? { task } : { error: "Unknown task.", status: 404 };
}

/** Pulls a list of checks out of a model's JSON reply. Anything invalid is dropped. */
export function parseSuggestedChecks(reply: string): CustomCheck[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const data = JSON.parse(reply.slice(start, end + 1)) as { checks?: unknown };
    if (!Array.isArray(data.checks)) return [];
    return data.checks
      .map(cleanCheck)
      .filter((c): c is CustomCheck => c !== null)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export const SUGGEST_INSTRUCTIONS = [
  "Convert the description of a good answer below into objective checks that a simple rule can verify.",
  'Reply with JSON only, in this shape: {"checks":[{"kind":"...","text":"...","value":0}]}',
  "Allowed kinds:",
  '- "maxWords": value is the word limit',
  '- "includes": text is a short exact phrase or number that must appear',
  '- "excludes": text is a short exact phrase that must not appear',
  '- "startsWith": text is what the answer must begin with',
  '- "singleParagraph": one paragraph with no bullets (no text or value)',
  '- "numberedItems": value is the exact number of numbered list items',
  '- "listOnly": a numbered list with no intro or closing line (no text or value)',
  "Rules: at most 6 checks. Use only requirements stated in the description. Keep text under 60 characters and literal.",
  "Skip anything subjective such as tone or quality. If nothing can be checked, return an empty list.",
].join("\n");

/** Offline stand-in for the suggestion model, used only in mock mode. */
export function mockSuggest(goal: string): CustomCheck[] {
  const found: CustomCheck[] = [];
  const words = goal.match(/(\d{1,4})\s*-?\s*words?/i);
  if (words) found.push({ kind: "maxWords", value: Number(words[1]) });
  for (const quoted of goal.matchAll(/"([^"]{1,60})"/g)) found.push({ kind: "includes", text: quoted[1] });
  if (/paragraph|no bullets?/i.test(goal)) found.push({ kind: "singleParagraph" });
  const items = goal.match(/(\d{1,2})\s+(numbered\s+)?(items|points|steps)/i);
  if (items) found.push({ kind: "numberedItems", value: Number(items[1]) });
  return found.map(cleanCheck).filter((c): c is CustomCheck => c !== null).slice(0, 6);
}
