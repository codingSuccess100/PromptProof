// One command, one shareable report:  npm run report
//
// 1. Checks the configured Gemini model works (and suggests a working one if not).
// 2. Latency: 1 call, then 5 and 8 in parallel.
// 3. Task 1 with a weak prompt and a strong prompt, three runs each.
// 4. X-ray on a reference prompt, three times, to see how often the labels repeat.
//
// Writes promptproof-report.md. The API key is never written to the report.
// With no key it runs against the offline mock so you can see the report shape.
// A full run makes about 50 small model calls.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runTask, xrayTask } from "../src/lib/engine";
import { DEFAULT_MODEL, buildModelInput } from "../src/lib/model";
import { getTask } from "../src/lib/tasks";
import type { RunResult, XrayResult } from "../src/lib/types";

const REPORT_PATH = "promptproof-report.md";
const API = "https://generativelanguage.googleapis.com/v1beta";

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

const key = process.env.GEMINI_API_KEY ?? "";
const mock = key.length === 0;
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
  writeFileSync(REPORT_PATH, text);
}

// ---------- raw calls (so we can see HTTP statuses) ----------

interface RawResult {
  ms: number;
  status: number;
  empty: boolean;
  note: string;
}

async function rawCall(model: string): Promise<RawResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildModelInput(task!, XRAY_PROMPT) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      error?: { message?: string };
    };
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const note = res.ok ? (body.candidates?.[0]?.finishReason ?? "") : (body.error?.message ?? "").slice(0, 160);
    return { ms: Date.now() - started, status: res.status, empty: res.ok && text.trim() === "", note };
  } catch (err) {
    return { ms: Date.now() - started, status: 0, empty: false, note: err instanceof Error ? err.name : "error" };
  }
}

async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  } catch {
    return [];
  }
}

/** Finds a model that answers. Tries the configured one first, then fast text models from the account's list. */
async function pickModel(): Promise<string | null> {
  const configured = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const first = await rawCall(configured);
  out(`| ${configured} (configured) | ${first.status} | ${first.ms} | ${cell(first.note)} |`);
  if (first.status === 200 && !first.empty) return configured;
  if (first.status === 400 || first.status === 401 || first.status === 403) {
    if (/key/i.test(first.note)) return null; // bad key: no point trying other models
  }
  const available = await listModels();
  const candidates = available
    .filter((m) => /flash/.test(m) && !/image|tts|audio|live|embed|omni|transcribe|robotics/.test(m))
    .sort((a, b) => Number(/lite/.test(b)) - Number(/lite/.test(a)) || b.localeCompare(a))
    .filter((m) => m !== configured)
    .slice(0, 5);
  for (const model of candidates) {
    const result = await rawCall(model);
    out(`| ${model} | ${result.status} | ${result.ms} | ${cell(result.note)} |`);
    if (result.status === 200 && !result.empty) return model;
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
    const results = await Promise.all(Array.from({ length: n }, () => rawCall(model)));
    const wall = Date.now() - started;
    const good = results.filter((r) => r.status === 200 && !r.empty).length;
    const statuses = [...new Set(results.map((r) => r.status))].join(", ");
    if (results.some((r) => r.status === 429)) sawLimit = true;
    batches.push({ n, ok: good === n, wall });
    out(
      `| ${n} parallel | ${wall} | ${Math.max(...results.map((r) => r.ms))} | ${good}/${n} | ` +
        `${results.filter((r) => r.empty).length} | ${statuses} |`,
    );
  }
  out();
  const eight = batches.filter((b) => b.n === 8);
  const eightOk = eight.every((b) => b.ok);
  const fiveOk = batches.find((b) => b.n === 5)?.ok ?? false;
  const recommended = eightOk ? 8 : fiveOk ? 5 : 2;
  out(`Recommended setting: \`MAX_PARALLEL=${recommended}\``);
  if (sawLimit) out("Rate limit responses (429) were seen. The free tier is too small for the X-ray. See the handoff notes about billing.");
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
    name: 'Demo moment: "You are an expert analyst." shows no measured effect',
    pass: persona.every((l) => l === "no_measured_effect"),
    note: persona.join(", "),
  });
}

// ---------- main ----------

async function main() {
  out("# PromptProof benchmark report");
  out();
  out(`- Generated: ${new Date().toISOString()}`);
  out(`- Mode: ${mock ? "OFFLINE MOCK (no API key found). These numbers say nothing about a real model." : "Gemini API"}`);
  out(`- Node: ${process.version}`);
  out(`- API key: ${mock ? "not set" : "set (never written to this file)"}`);
  out();

  if (mock) {
    out("To run against Gemini, create `.env.local` in the project folder with one line:");
    out();
    out("```");
    out("GEMINI_API_KEY=paste_your_key_here");
    out("```");
    out();
  } else {
    out("## 1. Model check");
    out();
    out("| Model | HTTP status | Time (ms) | Note |");
    out("|---|---|---|---|");
    const model = await pickModel();
    out();
    if (!model) {
      out("No working model found. Check that the key is valid and that the Gemini API is enabled for it.");
      verdicts.push({ name: "A model answers", pass: false, note: "see section 1" });
      return;
    }
    if (model !== (process.env.GEMINI_MODEL || DEFAULT_MODEL)) {
      out(`The configured model did not work. Add this line to \`.env.local\`: \`GEMINI_MODEL=${model}\``);
      out();
    }
    process.env.GEMINI_MODEL = model;
    out(`Using model: \`${model}\``);
    out();
    const limited = await latencySection(model);
    if (limited) {
      console.log("Rate limit hit. Waiting 65 seconds before the next section.");
      await sleep(65_000);
    }
  }

  await promptSection();
  await xraySection();
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
