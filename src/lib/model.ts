import { mockGenerate } from "./mock";
import type { Task } from "./types";

// The single place that talks to an AI provider. Server-side only.
// With no OPENAI_API_KEY the app falls back to the labeled offline mock.
// The key is read from the environment, sent only in the Authorization header,
// and never logged or returned.

// Checked against the OpenAI pricing and model pages on Nov 13, 2026:
// the lowest-cost current-generation model, rated "Fast", and it allows reasoning to be turned off.
// Override with OPENAI_MODEL.
export const DEFAULT_MODEL = "gpt-6-luna";
export const FALLBACK_MODELS = ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-nano", "gpt-5-nano"];

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 25_000;
// Output budgets, in tokens. An answer needs far more room than a short structured analysis.
// The answer budget is part of the evaluation context, so an original and its revision always share it.
export const ANSWER_TOKENS = (() => {
  const n = Math.floor(Number(process.env.OPENAI_MAX_OUTPUT_TOKENS));
  return Number.isFinite(n) && n >= 200 ? Math.min(n, 8000) : 2000;
})();
export const LONG_ANSWER_TOKENS = Math.max(4000, ANSWER_TOKENS * 2);
const ANALYSIS_TOKENS = 1500;

export interface ModelReply {
  text: string;
  model: string;
  mock: boolean;
  /** False when the provider stopped at the output limit. */
  complete: boolean;
}

export interface RawReply {
  status: number; // HTTP status, or 0 for a network error or timeout
  text: string;
  /** The provider's finish reason: "stop" for a complete answer, "length" when it hit the output limit. */
  finish: string;
  ms: number;
  note: string; // short, safe description of what went wrong (never contains the key)
}

export function configuredModel(): string {
  return (process.env.OPENAI_MODEL || "").trim() || DEFAULT_MODEL;
}

/**
 * The key as usable in a header: surrounding spaces, line breaks, and quotes removed.
 * Pasting a key into a hosting dashboard often adds one of these, and a header with a
 * line break in it cannot be sent at all.
 */
export function apiKey(): string {
  return (process.env.OPENAI_API_KEY ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

/** A problem with the key that we can see without calling the API, or null. Never includes the key. */
export function keyProblem(key: string): string | null {
  if (!key) return null;
  if (/[^\x21-\x7e]/.test(key)) return "the API key contains a space, line break, or hidden character. Paste it again";
  if (!key.startsWith("sk-")) return 'the API key does not start with "sk-". Check that the right value was pasted';
  return null;
}

export function modelInfo(): { model: string; mock: boolean } {
  return apiKey()
    ? { model: configuredModel(), mock: false }
    : { model: "offline mock model", mock: true };
}

/** The generation settings, recorded with every result so runs under different settings are never compared. */
export function modelSettings(outputTokens = ANSWER_TOKENS): string {
  if (!apiKey()) return `offline mock, max_output_tokens=${outputTokens}`;
  return `reasoning_effort=${process.env.OPENAI_REASONING_EFFORT || "none"}, temperature=0, max_output_tokens=${outputTokens}`;
}

/** What the model actually receives: the user's prompt, then the task material. Never the situation card. */
export function buildModelInput(task: Task, prompt: string): string {
  return task.sourceMaterial ? `${prompt.trim()}\n\n---\n${task.sourceMaterial}` : prompt.trim();
}

// Some models reject optional settings (for example temperature while reasoning is on).
// When the API says so, we drop that setting for the model and remember it.
const unsupported = new Map<string, Set<string>>();

function requestBody(model: string, input: string, json: boolean, maxTokens: number): Record<string, unknown> {
  const skip = unsupported.get(model) ?? new Set<string>();
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: input }],
    max_completion_tokens: maxTokens,
  };
  // No reasoning step: faster, cheaper, and it lets us set temperature to 0 for repeatable answers.
  if (!skip.has("reasoning_effort")) body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "none";
  if (!skip.has("temperature")) body.temperature = 0;
  // Ask for a JSON object when the caller needs structured output. Dropped automatically if a model rejects it.
  if (json && !skip.has("response_format")) body.response_format = { type: "json_object" };
  return body;
}

function safeNote(status: number, code: string, message: string): string {
  if (status === 401) return "the API key was rejected";
  if (code === "insufficient_quota") return "the OpenAI account has no credit (add billing credit)";
  if (status === 429) return "rate limited";
  if (status === 404 || code === "model_not_found") return "model not found or not available to this key";
  // Strip anything that looks like a key before keeping a short excerpt.
  return `${code || `status ${status}`}: ${message.replace(/sk-[A-Za-z0-9_\-*]+/g, "[key]").slice(0, 140)}`;
}

/** One request, no retry on failure. Exposed so the benchmark can see statuses and timings. */
export async function rawCall(input: string, key: string, model: string, json = false, maxTokens = ANSWER_TOKENS): Promise<RawReply> {
  const started = Date.now();
  const problem = keyProblem(key);
  if (problem) return { status: 0, text: "", finish: "", ms: 0, note: problem };
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(requestBody(model, input, json, maxTokens)),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        error?: { message?: string; code?: string; param?: string };
      };
      if (res.ok) {
        const text = (data.choices?.[0]?.message?.content ?? "").trim();
        const finish = data.choices?.[0]?.finish_reason ?? "unknown";
        const note = text ? "" : `empty answer (finish reason: ${finish})`;
        return { status: res.status, text, finish, ms: Date.now() - started, note };
      }
      const message = data.error?.message ?? "";
      const param = data.error?.param ?? "";
      // Adapt once per optional setting the model does not accept, then try again.
      if (res.status === 400) {
        const skip = unsupported.get(model) ?? new Set<string>();
        const bad = ["temperature", "reasoning_effort", "response_format"].find(
          (name) => !skip.has(name) && (param === name || message.includes(name)),
        );
        if (bad) {
          skip.add(bad);
          unsupported.set(model, skip);
          continue;
        }
      }
      return { status: res.status, text: "", finish: "", ms: Date.now() - started, note: safeNote(res.status, data.error?.code ?? "", message) };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      // Name the low-level reason (for example ENOTFOUND or ECONNRESET) so the failure can be diagnosed.
      const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
      const detail = (cause?.code || cause?.message || (err instanceof Error ? err.message : "") || "").replace(/sk-[A-Za-z0-9_\-*]+/g, "[key]").slice(0, 80);
      const note = timedOut ? "the model timed out" : `could not reach OpenAI${detail ? `: ${detail}` : ""}`;
      return { status: 0, text: "", finish: "", ms: Date.now() - started, note };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 400, text: "", finish: "", ms: Date.now() - started, note: "the model rejected the request settings" };
}

/** Which optional settings were dropped for a model, for the benchmark report. */
export function droppedSettings(model: string): string[] {
  return [...(unsupported.get(model) ?? [])];
}

async function callOpenAI(input: string, key: string, model: string, json: boolean, maxTokens: number): Promise<{ text: string; complete: boolean }> {
  let last: RawReply | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await rawCall(input, key, model, json, maxTokens);
    // "length" means the provider cut the answer off. It is returned, and marked incomplete, never stitched or retried silently.
    if (last.status === 200 && last.text) return { text: last.text, complete: last.finish !== "length" };
    // Retry once on rate limits, server errors, timeouts, and empty answers only.
    const retryable = last.status === 429 || last.status >= 500 || last.status === 0 || last.status === 200;
    if (!retryable || last.note.includes("no credit") || last.note.includes("API key")) break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(last?.note || "unknown error");
}

export async function generate(task: Task, prompt: string): Promise<ModelReply> {
  const key = apiKey();
  const budget = task.outputTokens ?? ANSWER_TOKENS;
  if (!key) {
    // Optional pause so loading states can be seen and rehearsed without a key.
    const pause = Number(process.env.MOCK_DELAY_MS);
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(pause, 5000)));
    const full = mockGenerate(task, prompt);
    // MOCK_TRUNCATE=1 simulates a provider cut-off, to rehearse the incomplete-answer path.
    const cut = process.env.MOCK_TRUNCATE === "1" && full.length > 40;
    return { text: cut ? full.slice(0, Math.floor(full.length * 0.6)) : full, model: "offline mock model", mock: true, complete: !cut };
  }
  const model = configuredModel();
  const reply = await callOpenAI(buildModelInput(task, prompt), key, model, false, budget);
  return { ...reply, model, mock: false };
}

/**
 * Free-form call with no task attached, used for analysis. Returns null in mock mode.
 * A structured (JSON) reply that was cut off is an error: a partial object must never be read as a full analysis.
 */
export async function generateText(input: string, options: { json?: boolean; maxTokens?: number } = {}): Promise<ModelReply | null> {
  const key = apiKey();
  if (!key) return null;
  const model = configuredModel();
  const reply = await callOpenAI(input, key, model, !!options.json, options.maxTokens ?? ANALYSIS_TOKENS);
  if (options.json && !reply.complete) throw new Error("the analysis was cut off before it finished");
  return { ...reply, model, mock: false };
}

/** Runs async jobs with a cap on how many are in flight at once. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
