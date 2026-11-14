// One command, one shareable report:  npm run report
//
// 1. Checks the configured OpenAI model works (and suggests a working one if not).
// 2. Latency: 1 call, then 5 and 8 in parallel.
// 3. Task 1 with a weak prompt and a strong prompt, three runs each.
// 4. X-ray on a reference prompt, three times, to see how often the labels repeat.
//
// Writes promptproof-report.md. The API key is never written to the report.
// With no key it stops with an error. `npm run report:mock` runs the offline mock instead,
// only to show the report shape.
// 5. Suggest checks on six ordinary-language goals.
// 6. Goal review on the vendor-message case, an on-task case, and the calculus case.
// 7. Release journeys A to G: each one is PASS, FAIL, or BLOCKED (the request itself failed).
// A full run makes about 80 small model calls.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runTask, xrayTask } from "../src/lib/engine";
import { FALLBACK_MODELS, buildModelInput, configuredModel, droppedSettings, rawCall } from "../src/lib/model";
import { buildCustomTask, resolveTask } from "../src/lib/custom";
import { scoreOutput } from "../src/lib/checks";
import { proposeRevision } from "../src/lib/improve";
import { reviewGoal } from "../src/lib/review";
import { suggestChecks } from "../src/lib/suggest";
import { getTask } from "../src/lib/tasks";
import type { RunResult, XrayResult } from "../src/lib/types";

const REPORT_PATH = "promptproof-report.md";

const WEAK_PROMPT = "Summarize this feedback.";
const STRONG_PROMPT =
  "Summarize this customer feedback for our CFO in one plain paragraph with no bullet points. " +
  "Keep it under 60 words. Start with the billing errors, not the delivery complaints. " +
  "Mention that refunds for billing errors cost $1,200 last month. " +
  "Say that a decision is needed by Friday.";
const XRAY_PROMPT =
  "You are an expert analyst. Summarize this feedback for our CFO under 60 words, " +
  "put billing errors first, mention the $1,200 refund cost.";

// ---------- setup ----------

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[2] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const key = (process.env.OPENAI_API_KEY ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
const mock = process.argv.includes("--mock");
if (mock) {
  delete process.env.OPENAI_API_KEY;
} else if (!key) {
  console.error(
    [
      "",
      "STOPPED: no OPENAI_API_KEY found, so this would only test the offline mock.",
      "",
      "Create a file named .env.local next to package.json with this one line:",
      "",
      "  OPENAI_API_KEY=paste_your_key_here",
      "",
      "Then run:  npm run report",
      "(To see the report shape without a key:  npm run report:mock)",
      "",
    ].join("\n"),
  );
  process.exit(1);
} else {
  process.env.OPENAI_API_KEY = key;
}
const task = getTask("cfo-summary");
if (!task) throw new Error("Task 1 is missing.");

const lines: string[] = [];
const verdicts: { name: string; pass: boolean | null; note: string }[] = [];
const out = (text = "") => {
  lines.push(text);
  console.log(text);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function save() {
  // Belt and braces: strip the key if it somehow ended up in any text.
  let text = lines.join("\n") + "\n";
  if (key) text = text.split(key).join("[REDACTED]");
  text = text.replace(/sk-[A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
  writeFileSync(REPORT_PATH, text);
}

// ---------- model check ----------

const input = () => buildModelInput(task!, XRAY_PROMPT);

/** Finds a model that answers. Tries the configured one first, then other low-cost models. */
async function pickModel(): Promise<string | null> {
  const configured = configuredModel();
  const candidates = [configured, ...FALLBACK_MODELS.filter((m) => m !== configured)];
  for (const model of candidates) {
    const result = await rawCall(input(), key, model);
    const good = result.status === 200 && result.text !== "";
    out(`| ${model}${model === configured ? " (configured)" : ""} | ${result.status} | ${result.ms} | ${cell(good ? "ok" : result.note)} |`);
    if (good) return model;
    // A rejected key or an empty balance fails the same way on every model.
    if (result.status === 401 || result.note.includes("no credit")) return null;
  }
  return null;
}

// ---------- sections ----------

async function latencySection(model: string): Promise<boolean> {
  out("## 2. Latency");
  out();
  out("| Batch | Wall time (ms) | Slowest call (ms) | OK | Empty answers | HTTP statuses |");
  out("|---|---|---|---|---|---|");
  let sawLimit = false;
  const batches: { n: number; ok: boolean; wall: number }[] = [];
  for (const n of [1, 5, 8, 8]) {
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: n }, () => rawCall(input(), key, model)));
    const wall = Date.now() - started;
    const good = results.filter((r) => r.status === 200 && r.text !== "").length;
    const statuses = [...new Set(results.map((r) => r.status))].join(", ");
    if (results.some((r) => r.status === 429)) sawLimit = true;
    batches.push({ n, ok: good === n, wall });
    out(
      `| ${n} parallel | ${wall} | ${Math.max(...results.map((r) => r.ms))} | ${good}/${n} | ` +
        `${results.filter((r) => r.status === 200 && r.text === "").length} | ${statuses} |`,
    );
  }
  out();
  const eight = batches.filter((b) => b.n === 8);
  const eightOk = eight.every((b) => b.ok);
  const fiveOk = batches.find((b) => b.n === 5)?.ok ?? false;
  const recommended = eightOk ? 8 : fiveOk ? 5 : 2;
  out(`Recommended setting: \`MAX_PARALLEL=${recommended}\``);
  if (sawLimit) out("Rate limit responses (429) were seen. Lower MAX_PARALLEL or raise the usage tier of the OpenAI account.");
  out();
  verdicts.push({
    name: "8 parallel calls succeed",
    pass: eightOk,
    note: eightOk ? `worst wall time ${Math.max(...eight.map((b) => b.wall))} ms` : "some calls failed",
  });
  process.env.MAX_PARALLEL = String(recommended);
  return sawLimit;
}

async function promptSection() {
  out("## 3. Task 1: weak prompt against strong prompt");
  out();
  const rows: { name: string; prompt: string; runs: (RunResult | string)[] }[] = [
    { name: "Weak", prompt: WEAK_PROMPT, runs: [] },
    { name: "Strong", prompt: STRONG_PROMPT, runs: [] },
  ];
  for (const row of rows) {
    for (let i = 0; i < 3; i++) {
      try {
        row.runs.push(await runTask(task!, row.prompt));
      } catch (err) {
        row.runs.push(err instanceof Error ? err.message : "failed");
      }
    }
  }
  out("| Prompt | Scores (3 runs, out of 5) | Checks missed in run 1 | Time per run (ms) | Failures |");
  out("|---|---|---|---|---|");
  for (const row of rows) {
    const good = row.runs.filter((r): r is RunResult => typeof r !== "string");
    const failed = row.runs.filter((r): r is string => typeof r === "string");
    const missed = good[0]?.checks.filter((c) => !c.pass).map((c) => c.id).join(", ") || "none";
    out(
      `| ${row.name} | ${good.map((r) => r.score).join(", ") || "none"} | ${missed} | ` +
        `${good.map((r) => r.ms).join(", ") || "none"} | ${failed.length ? cell(failed.join("; ")) : 0} |`,
    );
  }
  out();
  for (const row of rows) {
    const first = row.runs.find((r): r is RunResult => typeof r !== "string");
    out(`**${row.name} prompt:** ${row.prompt}`);
    out();
    out("```");
    out(first ? first.output.slice(0, 900) : "(no answer)");
    out("```");
    out();
  }
  const scores = (name: string) =>
    rows.find((r) => r.name === name)!.runs.filter((r): r is RunResult => typeof r !== "string").map((r) => r.score);
  const weak = scores("Weak");
  const strong = scores("Strong");
  verdicts.push({
    name: "Weak prompt scores 2 or less every run",
    pass: weak.length === 3 ? weak.every((s) => s <= 2) : null,
    note: weak.join(", ") || "no successful runs",
  });
  verdicts.push({
    name: "Strong prompt scores 4 or more every run",
    pass: strong.length === 3 ? strong.every((s) => s >= 4) : null,
    note: strong.join(", ") || "no successful runs",
  });
}

async function xraySection() {
  out("## 4. X-ray repeatability");
  out();
  out(`Prompt: ${XRAY_PROMPT}`);
  out();
  const runs: (XrayResult | string)[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      runs.push(await xrayTask(task!, XRAY_PROMPT, { runs: 1 }));
    } catch (err) {
      runs.push(err instanceof Error ? err.message : "failed");
    }
  }
  const good = runs.filter((r): r is XrayResult => typeof r !== "string");
  const failed = runs.filter((r): r is string => typeof r === "string");
  if (good.length === 0) {
    out(`All three X-ray runs failed: ${cell(failed.join("; "))}`);
    out();
    verdicts.push({ name: "X-ray labels repeat", pass: null, note: "no successful runs" });
    verdicts.push({ name: "X-ray under 10 seconds", pass: null, note: "no successful runs" });
    return;
  }
  out(`| Part of the prompt | ${good.map((_, i) => `Run ${i + 1}`).join(" | ")} | Same every run |`);
  out(`|---|${good.map(() => "---|").join("")}---|`);
  let stable = 0;
  const parts = good[0].ablations;
  for (const part of parts) {
    const labels = good.map((x) => x.ablations.find((a) => a.chunkIndex === part.chunkIndex)?.label ?? "missing");
    const same = new Set(labels).size === 1;
    if (same) stable++;
    out(`| ${cell(part.text)} | ${labels.join(" | ")} | ${same ? "yes" : "NO"} |`);
  }
  out();
  out(`| | ${good.map((_, i) => `Run ${i + 1}`).join(" | ")} |`);
  out(`|---|${good.map(() => "---|").join("")}`);
  out(`| Baseline score | ${good.map((x) => `${x.baselineScore}/${x.total}`).join(" | ")} |`);
  out(`| Model calls | ${good.map((x) => x.modelCalls).join(" | ")} |`);
  out(`| Time (ms) | ${good.map((x) => x.ms).join(" | ")} |`);
  out();
  if (failed.length) out(`Failed X-ray runs: ${failed.length} (${cell(failed.join("; "))})`);
  out();
  const share = parts.length ? stable / parts.length : 0;
  verdicts.push({
    name: "X-ray labels repeat on at least 80% of parts",
    pass: good.length === 3 ? share >= 0.8 : null,
    note: `${stable} of ${parts.length} parts identical across ${good.length} runs`,
  });
  verdicts.push({
    name: "X-ray finishes in under 10 seconds",
    pass: median(good.map((x) => x.ms)) < 10_000,
    note: `median ${median(good.map((x) => x.ms))} ms`,
  });
  const persona = good.map((x) => x.ablations[0]?.label);
  verdicts.push({
    name: 'Observation only: label measured for "You are an expert analyst." (whatever it is, the app reports it as measured)',
    pass: persona.every((l) => l === "no_measured_effect"),
    note: persona.join(", "),
  });
}

async function suggestSection() {
  out("## 5. Suggest checks, on ordinary language");
  out();
  out("| What the user typed | Outcome | Proposed checks | Left to goal review | Question asked |");
  out("|---|---|---|---|---|");
  const cases = [
    "Under 80 words and one paragraph.",
    "A comprehensive study plan.",
    "Explain L\u2019H\u00f4pital\u2019s rule with examples.",
    "Keep the exact ticket ID ABC-123.",
    "Give me a clear study plan with examples and no more than 300 words.",
    "One paragraph, and exactly 3 numbered steps.",
  ];
  let deadEnds = 0;
  let failures = 0;
  for (const goal of cases) {
    try {
      const r = await suggestChecks(goal);
      if (r.checks.length === 0 && r.questions.length === 0 && r.qualitative.length === 0 && r.status !== "ready") deadEnds++;
      out(`| ${cell(goal)} | ${r.status}${r.warning ? " (contradiction flagged)" : ""} | ${cell(r.checks.map((c) => `${c.kind}${c.value ? " " + c.value : ""}${c.text ? " \"" + c.text + "\"" : ""}`).join("; ")) || "none"} | ${cell(r.qualitative.join(", ")) || "none"} | ${cell(r.questions.map((q) => `${q.id} (${q.type}): ${q.question}`).join("; ")) || "none"} |`);
    } catch (err) {
      failures++;
      out(`| ${cell(goal)} | REQUEST FAILED | | | ${cell(err instanceof Error ? err.message : "error")} |`);
    }
  }
  out();
  verdicts.push({ name: "Suggest checks never dead-ends", pass: failures === cases.length ? null : deadEnds === 0, note: `${deadEnds} dead ends, ${failures} failed requests out of ${cases.length}` });
}

async function reviewSection() {
  out("## 6. Goal review, kept separate from the rule-based checks");
  out();
  const VENDOR = "Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.";
  const calc = buildCustomTask({ goal: "A comprehensive plan to study for my calculus test", material: "", checks: [{ kind: "includes", text: "LHopital" }, { kind: "maxWords", value: 60 }] });
  const cases: { name: string; task: NonNullable<typeof task>; prompt: string; expectConcern: boolean }[] = [
    { name: "CFO task, vendor-message prompt", task: task!, prompt: VENDOR, expectConcern: true },
    { name: "CFO task, on-task prompt", task: task!, prompt: STRONG_PROMPT, expectConcern: false },
  ];
  if ("task" in calc) cases.push({ name: "Calculus goal with an odd exact string and a 60 word limit", task: calc.task, prompt: "I have a calculus midterm in 5 days. Give me a comprehensive study plan. Include LHopital. Use 60 words or fewer.", expectConcern: true });
  out("| Case | Rule-based checks | Goal review | First finding | Evidence quoted from the prompt | Suggested edit |");
  out("|---|---|---|---|---|---|");
  let asExpected = 0;
  let done = 0;
  for (const c of cases) {
    try {
      const run = await runTask(c.task, c.prompt);
      const review = await reviewGoal(c.task, run.prompt, run.output);
      done++;
      const f = review.findings[0];
      if ((review.status === "concerns") === c.expectConcern) asExpected++;
      out(`| ${c.name} | ${run.score} of ${run.total} | ${review.status} | ${cell(f ? `${f.kind}: ${f.what}` : review.summary)} | ${cell(f?.promptEvidence ?? "") || "none"} | ${cell(f?.suggestedEdit ?? "") || "none"} |`);
    } catch (err) {
      out(`| ${c.name} | REQUEST FAILED | | ${cell(err instanceof Error ? err.message : "error")} | | |`);
    }
  }
  out();
  out("The review is model-assisted and can be wrong. Read the three rows and judge whether the findings are sensible.");
  out();
  verdicts.push({ name: "Goal review flags the vendor prompt and the odd calculus criteria, and not the on-task prompt", pass: mock ? null : done === cases.length ? asExpected === cases.length : null, note: `${asExpected} of ${cases.length} as expected, ${done} completed` });
}

async function journeySection() {
  out("## 7. Release journeys");
  out();
  out("Each row states what should happen, written from the task and not from the code. BLOCKED means the request failed, so the journey was not judged.");
  out();
  out("| Journey | Expected | Observed | Result |");
  out("|---|---|---|---|");
  const row = async (id: string, expected: string, fn: () => Promise<{ pass: boolean; seen: string }>) => {
    try {
      const r = await fn();
      out(`| ${id} | ${expected} | ${cell(r.seen)} | ${r.pass ? "PASS" : "FAIL"} |`);
      verdicts.push({ name: `Journey ${id}`, pass: r.pass, note: r.seen });
    } catch (err) {
      const note = err instanceof Error ? err.message : "error";
      out(`| ${id} | ${expected} | ${cell(note)} | BLOCKED |`);
      verdicts.push({ name: `Journey ${id}`, pass: null, note: `blocked: ${note}` });
    }
  };
  const own = (goal: string, checks: unknown[] = [], long = false) => {
    const built = resolveTask("custom", { goal, material: "", checks }, long);
    if (!("task" in built)) throw new Error(built.error);
    return built.task;
  };
  const CALC_PROMPT = "i want to study for calc 3 midterm";
  const CALC_GOAL = "I want a full study guide with dates on what to do each day.";

  await row("A. Calculus clarification", "No question about what kind of subject it is. A date question typed as a date. At most 2 questions. Answering the date removes that question.", async () => {
    const first = await suggestChecks(CALC_GOAL, { prompt: CALC_PROMPT });
    const text = JSON.stringify(first.questions).toLowerCase();
    const date = first.questions.find((q) => q.type === "date");
    const second = await suggestChecks(CALC_GOAL, { prompt: CALC_PROMPT, answers: date ? [{ id: date.id, question: date.question, type: "date", value: "2026-12-04" }] : [] });
    const repeated = date ? second.questions.some((q) => q.id === date.id || q.type === "date") : true;
    return {
      pass: !/school subject|standardized|certification/.test(text) && Boolean(date) && first.questions.length <= 2 && !repeated,
      seen: `first: ${first.questions.map((q) => `${q.id} (${q.type})`).join(", ") || "no questions"}; after the date answer: ${second.questions.map((q) => `${q.id} (${q.type})`).join(", ") || "no questions"}`,
    };
  });

  await row("B. Exact wording versus topic", "A required string is matched as whole words. \"Friday\" inside another word does not count, and an amount is never fuzzy.", async () => {
    const t = own("Mention the deadline", [{ kind: "includes", text: "Friday" }, { kind: "includes", text: "$1,200" }]);
    const hit = scoreOutput(t, "We need a decision by friday. Refunds cost $1,200.").score;
    const miss = scoreOutput(t, "Fridays are busy. Refunds cost $1,2000.").score;
    return { pass: hit === 2 && miss === 0, seen: `matching answer ${hit} of 2, near-miss answer ${miss} of 2 (no model call, this is the rule itself)` };
  });

  await row("C. CFO ordering", "\"Billing is the first issue named\" fails when delivery is named first, and passes on a live answer to the strong prompt.", async () => {
    const check = (text: string) => scoreOutput(task!, text).checks.find((c) => c.id === "billing-first")!.pass;
    const counter = check("Delivery delays and billing errors were the main issues.");
    const run = await runTask(task!, STRONG_PROMPT);
    const live = run.checks.find((c) => c.id === "billing-first")!.pass;
    return { pass: !counter && live && run.complete, seen: `counterexample ${counter ? "passed (wrong)" : "failed (right)"}; live strong-prompt answer ${live ? "passed" : "failed"}: "${run.output.slice(0, 110)}"` };
  });

  await row("D. Qualitative-only improvement", "With zero rule-based checks, a goal concern still produces one complete revised prompt that keeps the subject and invents no date.", async () => {
    const t = own(CALC_GOAL, [], true);
    const run = await runTask(t, CALC_PROMPT);
    const review = await reviewGoal(t, run.prompt, run.output, run.complete);
    const concerns = review.findings.map((f) => f.what);
    const p = await proposeRevision(t, CALC_PROMPT, run.output, [], concerns.length ? concerns : ["The answer is not a day-by-day guide."], []);
    const text = p.proposal?.prompt ?? "";
    const invented = /\b(20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i.test(text);
    return {
      pass: Boolean(p.proposal) && /calc/i.test(text) && !invented,
      seen: `review: ${review.status}, ${review.findings.length} finding(s), answer ${run.complete ? "complete" : "cut off"}; proposal (${p.proposal?.source ?? "none"}): "${text.slice(0, 220)}"`,
    };
  });

  await row("E. All checks pass, wrong task", "The vendor-message prompt can pass rule-based checks, and the goal review still reports a concern.", async () => {
    const VENDOR = "Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.";
    const run = await runTask(task!, VENDOR);
    const review = await reviewGoal(task!, run.prompt, run.output, run.complete);
    return { pass: review.status === "concerns", seen: `rule-based ${run.score} of ${run.total}; goal review ${review.status}: ${review.findings[0]?.what ?? review.summary}` };
  });

  await row("F. Constraint-preserving revision", "The revised prompt keeps $1,200, Friday, and the CFO from the original, and adds no unsupported amount.", async () => {
    const original = "Summarize this feedback for our CFO. Mention that refunds cost $1,200 last month and a decision is needed by Friday.";
    const run = await runTask(task!, original);
    const failed = run.checks.filter((c) => !c.pass).map((c) => c.id);
    const p = await proposeRevision(task!, original, run.output, failed, [], []);
    const text = p.proposal?.prompt ?? "";
    const kept = ["$1,200", "Friday", "CFO"].filter((d) => text.includes(d));
    const amounts = (text.match(/\$[\d,]+/g) ?? []).filter((a) => a !== "$1,200");
    return {
      pass: failed.length === 0 ? p.proposal === null || kept.length === 3 : kept.length === 3 && amounts.length === 0,
      seen: `${failed.length} failed check(s); kept ${kept.join(", ") || "nothing"}; other amounts: ${amounts.join(", ") || "none"}; placeholders: ${p.proposal?.placeholders.length ?? 0}; restored: ${p.proposal?.restored.join(", ") || "none"}`,
    };
  });

  await row("G. Truncated output", "A long answer under a tiny output limit is reported as incomplete, and the review of it is partial and claims nothing is missing.", async () => {
    const t = { ...own("A complete worked guide to every integration technique, with full examples.", []), outputTokens: 60 };
    const run = await runTask(t, "Write a complete worked guide to every integration technique in Calculus 2, with three full worked examples for each technique.");
    const review = await reviewGoal(t, run.prompt, run.output, run.complete);
    const absence = review.findings.filter((f) => f.kind === "missing_fact").length;
    if (mock && process.env.MOCK_TRUNCATE !== "1") return { pass: run.complete, seen: "offline mock answers are short, so this only shows a complete answer is reported complete. The live run exercises the limit." };
    return { pass: !run.complete && review.partial && absence === 0, seen: `answer ${run.complete ? "reported complete (wrong)" : "reported incomplete"}, ${run.output.length} characters; review partial: ${review.partial}; absence claims: ${absence}` };
  });
  out();
}

// ---------- main ----------

async function main() {
  out("# PromptProof benchmark report");
  out();
  out(`- Generated: ${new Date().toISOString()}`);
  out(`- Mode: ${mock ? "OFFLINE MOCK (requested with --mock). These numbers say nothing about a real model." : "OpenAI API"}`);
  out(`- Node: ${process.version}`);
  out(`- API key: ${mock ? "not set" : "set (never written to this file)"}`);
  out();

  if (mock) {
    out("This is the offline mock. Run `npm run report` with a key for real results.");
    out();
  } else {
    out("## 1. Model check");
    out();
    out("| Model | HTTP status | Time (ms) | Note |");
    out("|---|---|---|---|");
    const model = await pickModel();
    out();
    if (!model) {
      out("No working model found. See the Note column: fix the key, add billing credit, or set OPENAI_MODEL to a model your account can use.");
      verdicts.push({ name: "A model answers", pass: false, note: "see section 1" });
      return;
    }
    if (model !== configuredModel()) {
      out(`The configured model did not work. Add this line to \`.env.local\`: \`OPENAI_MODEL=${model}\``);
      out();
    }
    process.env.OPENAI_MODEL = model;
    out(`Using model: \`${model}\``);
    const dropped = droppedSettings(model);
    if (dropped.length) out(`This model rejected these settings, so they were left out: ${dropped.join(", ")}. Answers may vary more between runs.`);
    out();
    const limited = await latencySection(model);
    if (limited) {
      console.log("Rate limit hit. Waiting 65 seconds before the next section.");
      await sleep(65_000);
    }
  }

  await promptSection();
  await xraySection();
  await suggestSection();
  await reviewSection();
  await journeySection();
}

main()
  .catch((err) => {
    out(`Report stopped early: ${err instanceof Error ? err.message : "unknown error"}`);
  })
  .finally(() => {
    out("## Summary");
    out();
    out("| Check | Result | Detail |");
    out("|---|---|---|");
    for (const v of verdicts) {
      out(`| ${v.name} | ${v.pass === null ? "NOT MEASURED" : v.pass ? "PASS" : "FAIL"} | ${cell(v.note)} |`);
    }
    out();
    if (mock) out("Reminder: this was the offline mock. Rerun with a key before trusting any result.");
    save();
    console.log(`\nSaved ${REPORT_PATH}. Send that one file back. It contains no secrets.`);
  });
