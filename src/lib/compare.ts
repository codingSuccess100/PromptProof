import type { CheckResult, RunResult } from "./types";

// Pure helpers shared by the server, the tests, and the browser.
// A comparison is only meaningful inside one evaluation context.

export function sameContext(a: Pick<RunResult, "contextId">, b: Pick<RunResult, "contextId">): boolean {
  return a.contextId.length > 0 && a.contextId === b.contextId;
}

export interface CheckDiff {
  improved: CheckResult[];
  regressed: CheckResult[];
  unchangedPass: CheckResult[];
  unchangedFail: CheckResult[];
}

/** Check-by-check difference. Equal totals can hide a trade, so totals are never the whole story. */
export function compareChecks(before: CheckResult[], after: CheckResult[]): CheckDiff {
  const diff: CheckDiff = { improved: [], regressed: [], unchangedPass: [], unchangedFail: [] };
  for (const now of after) {
    const was = before.find((c) => c.id === now.id);
    if (!was) continue;
    if (!was.pass && now.pass) diff.improved.push(now);
    else if (was.pass && !now.pass) diff.regressed.push(now);
    else if (now.pass) diff.unchangedPass.push(now);
    else diff.unchangedFail.push(now);
  }
  return diff;
}

/** Null when the two runs must not be compared. Otherwise a plain-language conclusion. */
export function conclusion(before: RunResult, after: RunResult): string | null {
  if (!sameContext(before, after)) return null;
  const d = compareChecks(before.checks, after.checks);
  const names = (list: CheckResult[]) => list.map((c) => c.label).join("; ");
  if (before.prompt.trim() === after.prompt.trim()) {
    return d.improved.length + d.regressed.length === 0
      ? "Same prompt, same result. This is a repeat run, not a revision."
      : "Same prompt, different result. The model's answers vary between runs, so treat single results with care.";
  }
  if (d.improved.length > 0 && d.regressed.length === 0) {
    return `The revision met ${d.improved.length} more requirement${d.improved.length === 1 ? "" : "s"} in this run: ${names(d.improved)}. One run each, so rerun to confirm.`;
  }
  if (d.improved.length > 0 && d.regressed.length > 0) {
    return `A trade: the revision gained ${names(d.improved)} and lost ${names(d.regressed)}.`;
  }
  if (d.regressed.length > 0) return `The revision did worse in this run. It lost: ${names(d.regressed)}.`;
  return d.unchangedFail.length > 0
    ? "No improvement found. The same requirements passed and failed."
    : "Both versions met every requirement. If the revision is shorter, it is a shorter tested alternative, not automatically a better one.";
}

export interface DiffToken {
  text: string;
  type: "same" | "added" | "removed";
}

/** Word-level difference between two prompts, for highlighting what changed. */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = before.trim().split(/\s+/).filter(Boolean).slice(0, 400);
  const b = after.trim().split(/\s+/).filter(Boolean).slice(0, 400);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ text: a[i], type: "same" });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ text: a[i++], type: "removed" });
    } else {
      out.push({ text: b[j++], type: "added" });
    }
  }
  while (i < a.length) out.push({ text: a[i++], type: "removed" });
  while (j < b.length) out.push({ text: b[j++], type: "added" });
  return out;
}
