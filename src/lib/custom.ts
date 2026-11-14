import { countWords, foldLoose, normalizeText } from "./checks";
import { getTask } from "./tasks";
import { CUSTOM_TASK_ID } from "./types";
import { ANSWER_TOKENS, LONG_ANSWER_TOKENS } from "./model";
import type { BriefAnswer, CheckSpec, CustomCheck, CustomCheckKind, CustomTaskInput, Task } from "./types";

// Turns a user's own requirements into the same rule-based checks the practice scenarios use.
// User text is always escaped and matched literally. No user-supplied regex ever runs.

export const MAX_CUSTOM_CHECKS = 8;
export const MAX_MATERIAL_CHARS = 6000;
export const MAX_CHECK_TEXT = 120;
export const MAX_GOAL_CHARS = 600;

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

/**
 * How a text requirement is matched. One policy for every "contains", "does not mention", and "starts with" check:
 * - Capitalization is ignored.
 * - Straight and curly quotes, dash styles, and runs of spaces are treated as the same.
 * - Accents and spelling must match, unless you approve another spelling.
 * - The text must stand on its own: "ABC-123" does not match inside "ABC-1234".
 * This tests that the wording appears. It does not test that a topic is covered or explained correctly.
 */
export const MATCH_POLICY =
  "Capitalization, quote style, dash style, and spacing are ignored. Spelling and accents must match unless you approve another spelling. The text must stand on its own, so ABC-123 does not match inside ABC-1234.";

/** Whole-token boundaries, so identifiers and amounts cannot match inside longer ones. */
const bounded = (alternatives: string[]) => `(?<![\\p{L}\\p{N}])(?:${alternatives.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`;

/**
 * The goal as the reviewer and the proposer see it: the user's words, then confirmed details,
 * then what was left unspecified (so nothing gets invented), then topics to cover.
 * The generation model never receives any of this.
 */
export function composeGoal(goal: string, brief: BriefAnswer[] = [], coverage: string[] = []): string {
  const lines = [goal.trim()];
  const answered = brief.filter((b) => b.value !== null && b.value.trim() !== "");
  const skipped = brief.filter((b) => b.value === null);
  if (answered.length > 0) lines.push("Confirmed details:", ...answered.map((b) => `- ${b.question} ${b.value}`));
  if (skipped.length > 0) {
    lines.push("Not specified by the user. Do not invent these. Use a clearly labeled placeholder or a provisional version:", ...skipped.map((b) => `- ${b.question}${b.type === "date" ? " (no date given: use an undated Day 1, Day 2 structure)" : ""}`));
  }
  if (coverage.length > 0) lines.push("Topics the answer should cover (reviewed, not scored by a rule):", ...coverage.map((c) => `- ${c}`));
  return lines.filter(Boolean).join("\n");
}

function cleanBrief(raw: unknown): BriefAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is BriefAnswer => !!b && typeof b === "object" && typeof (b as BriefAnswer).id === "string" && typeof (b as BriefAnswer).question === "string")
    .slice(0, 8)
    .map((b) => ({
      id: b.id.slice(0, 40),
      question: b.question.slice(0, 200),
      type: b.type === "date" || b.type === "number" || b.type === "choice" ? b.type : "text",
      value: typeof b.value === "string" ? b.value.trim().slice(0, 600) : null,
    }));
}

function escapeRegex(text: string): string {
  return normalizeText(text)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

/** Returns a cleaned check, or null if it is not usable. */
export function cleanCheck(raw: unknown): CustomCheck | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, text, value } = raw as { kind?: unknown; text?: unknown; value?: unknown };
  if (typeof kind !== "string") return null;
  // Models often return a near miss such as "max_words" or "MaxWords". Accept those spellings of a supported kind.
  const wanted = kind.toLowerCase().replace(/[^a-z]/g, "");
  const k = KINDS.find((name) => name.toLowerCase() === wanted);
  if (!k) return null;
  if (NEEDS_TEXT.includes(k)) {
    if (typeof text !== "string") return null;
    const t = text.trim().replace(/\s+/g, " ");
    if (t.length === 0 || t.length > MAX_CHECK_TEXT) return null;
    const { alternatives } = raw as { alternatives?: unknown };
    const alts =
      k === "includes" && Array.isArray(alternatives)
        ? alternatives
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim().replace(/\s+/g, " "))
            .filter((a) => a.length > 0 && a.length <= MAX_CHECK_TEXT && a !== t)
            .slice(0, 4)
        : [];
    return alts.length > 0 ? { kind: k, text: t, alternatives: alts } : { kind: k, text: t };
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
      return `Contains the wording "${check.text}"${(check.alternatives ?? []).map((a) => ` or "${a}"`).join("")}`;
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
    case "includes": {
      const all = [text, ...(check.alternatives ?? [])];
      return {
        id,
        label,
        kind: "matches",
        pattern: bounded(all),
        flags: "iu",
        ghostClause: `Include "${text}".`,
        promptCue: all.map(escapeRegex).join("|"),
        literals: all,
      };
    }
    case "excludes":
      return {
        id,
        label,
        kind: "notMatches",
        pattern: bounded([text]),
        flags: "iu",
        literals: [text],
        ghostClause: `Do not mention "${text}".`,
        promptCue: `(no|not|without|avoid|leave out|exclude|never|omit)[^.]*${esc}`,
      };
    case "startsWith":
      return {
        id,
        label,
        kind: "startsWith",
        pattern: `^\\W*${esc}`,
        literals: [text],
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

/**
 * Spellings a user might also want to accept: without accents, without apostrophes.
 * These are offered for approval. They are never applied on their own.
 */
export function alternativesFor(text: string): string[] {
  const base = normalizeText(text).trim();
  const noAccents = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const candidates = [noAccents, base.replace(/'/g, ""), noAccents.replace(/'/g, "")];
  return Array.from(new Set(candidates)).filter((c) => c.length > 0 && c !== base && c !== text.trim());
}

/** Requirements that cannot all be met by one answer. Returns a plain-language reason, or null. */
export function findContradiction(checks: CustomCheck[]): string | null {
  const has = (kind: CustomCheckKind) => checks.filter((c) => c.kind === kind);
  const required = [...has("includes"), ...has("startsWith")];
  for (const banned of has("excludes")) {
    const b = foldLoose(banned.text ?? "");
    const clash = required.find((r) => [r.text ?? "", ...(r.alternatives ?? [])].some((t) => b.length > 0 && foldLoose(t).includes(b)));
    if (clash) return `Two requirements contradict each other: the answer must contain "${clash.text}" and must not mention "${banned.text}".`;
  }
  const limits = has("maxWords").map((c) => c.value ?? 0);
  if (new Set(limits).size > 1) return "There are two different word limits. Keep one.";
  if (limits.length > 0) {
    const needed = required.reduce((sum, r) => sum + countWords(r.text ?? ""), 0);
    if (needed > limits[0]) return `The required text alone is ${needed} words, which is over the ${limits[0]} word limit.`;
  }
  const lists = [...has("numberedItems"), ...has("listOnly")];
  if (has("singleParagraph").length > 0 && lists.length > 0) {
    return "The answer cannot be one plain paragraph and a numbered list at the same time. Keep one format.";
  }
  if (new Set(has("numberedItems").map((c) => c.value)).size > 1) return "There are two different list lengths. Keep one.";
  if (has("startsWith").length > 1) return "The answer can only start one way. Keep one \"must start with\" requirement.";
  const seen = new Set<string>();
  for (const c of checks) {
    const key = `${c.kind}|${foldLoose(c.text ?? "")}|${c.value ?? ""}`;
    if (seen.has(key)) return "Two requirements are the same. Remove the duplicate.";
    seen.add(key);
  }
  return null;
}

export function buildCustomTask(input: unknown): { task: Task } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Add at least one requirement for your own prompt." };
  const { material, checks: rawChecks, goal: rawGoal, brief, coverage } = input as Partial<CustomTaskInput>;
  const text = typeof material === "string" ? material : "";
  if (text.length > MAX_MATERIAL_CHARS) return { error: `Keep the material under ${MAX_MATERIAL_CHARS} characters.` };
  const topics = Array.isArray(coverage) ? coverage.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim().slice(0, MAX_CHECK_TEXT)).slice(0, 8) : [];
  const stated = typeof rawGoal === "string" ? rawGoal.trim().slice(0, MAX_GOAL_CHARS) : "";
  const goal = stated || topics.length > 0 ? composeGoal(stated, cleanBrief(brief), topics) : "";
  const checks = Array.isArray(rawChecks) ? rawChecks : [];
  // With a goal and no checks the answer is unscored: there is a goal review, and no invented score.
  if (checks.length === 0 && goal.length === 0) {
    return { error: "Say what you want from the answer, or add at least one check, so there is something to evaluate against." };
  }
  if (checks.length > MAX_CUSTOM_CHECKS) return { error: `Use at most ${MAX_CUSTOM_CHECKS} requirements.` };
  const cleaned = checks.map(cleanCheck);
  if (cleaned.some((c) => c === null)) return { error: "One of the requirements is incomplete. Fill it in or remove it." };
  const conflict = findContradiction(cleaned as CustomCheck[]);
  if (conflict) return { error: conflict };
  return {
    task: {
      id: CUSTOM_TASK_ID,
      title: "Your own prompt",
      blurb: "Debug a prompt you actually use.",
      situationCard: [],
      goal,
      sourceMaterial: text.trim(),
      checks: (cleaned as CustomCheck[]).map(toSpec),
    },
  };
}

/** Finds a practice scenario by id, or builds the user's own task. */
export function resolveTask(taskId: unknown, custom: unknown, long: unknown = false): { task: Task } | { error: string; status: number } {
  // The answer budget is fixed per experiment, so an original and its revision are generated under the same limit.
  const outputTokens = long === true ? LONG_ANSWER_TOKENS : ANSWER_TOKENS;
  if (taskId === CUSTOM_TASK_ID) {
    const built = buildCustomTask(custom);
    return "task" in built ? { task: { ...built.task, outputTokens } } : { error: built.error, status: 400 };
  }
  const task = typeof taskId === "string" ? getTask(taskId) : undefined;
  return task ? { task: { ...task, outputTokens } } : { error: "Unknown task.", status: 404 };
}

/**
 * Tension between what the user asked for and a check they set.
 * Returned as a plain-language note with a choice for the user. Nothing is changed automatically.
 */
export function findTensions(goal: string, prompt: string, checks: CustomCheck[]): string[] {
  const notes: string[] = [];
  const wantsDepth = `${goal} ${prompt}`.match(/\b(comprehensive|detailed|thorough|in[- ]depth|complete|full|step[- ]by[- ]step|with examples)\b/i);
  const limit = checks.find((c) => c.kind === "maxWords");
  if (wantsDepth && limit && (limit.value ?? 0) <= 150) {
    notes.push(
      `You asked for something "${wantsDepth[0].toLowerCase()}" and also set a ${limit.value} word limit. A limit that short may force a compact outline instead of a fuller answer. Keep the limit if an outline is what you want, or raise or remove it.`,
    );
  }
  return notes;
}
