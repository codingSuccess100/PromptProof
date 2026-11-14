import { NextResponse } from "next/server";
import { apiKey, buildModelInput, configuredModel, keyProblem, rawCall } from "@/lib/model";
import { allowRequest } from "@/lib/ratelimit";
import { TASKS } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// A plain-language connection check: open /api/health in the browser.
// It makes one small model call and reports what happened. It never returns the key.
export async function GET(request: Request) {
  if (!allowRequest(request, "health", 10)) {
    return NextResponse.json({ ok: false, note: "Too many checks. Wait a few minutes." }, { status: 429 });
  }
  const key = apiKey();
  const model = configuredModel();
  if (!key) {
    return NextResponse.json({ ok: false, mode: "offline mock", note: "No OPENAI_API_KEY is set on this server, so the app is using the offline mock." });
  }
  const problem = keyProblem(key);
  if (problem) return NextResponse.json({ ok: false, mode: "live", model, keyLength: key.length, note: problem });
  const reply = await rawCall(buildModelInput(TASKS[0], "Summarize this feedback in one sentence."), key, model);
  const ok = reply.status === 200 && reply.text !== "";
  return NextResponse.json({
    ok,
    mode: "live",
    model,
    keyLength: key.length,
    httpStatus: reply.status,
    ms: reply.ms,
    note: ok ? "The model answered." : reply.note,
  });
}
