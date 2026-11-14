import { NextResponse } from "next/server";
import { resolveTask } from "@/lib/custom";
import { validatePrompt } from "@/lib/engine";
import { improveStep } from "@/lib/improve";
import { allowRequest } from "@/lib/ratelimit";
import type { ApiError, ImproveStep } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One step of "Improve and test": propose one edit, guard it, run it fresh.
// The browser drives the loop one step at a time, so cancelling really stops further calls.
export async function POST(request: Request): Promise<NextResponse<ImproveStep | ApiError>> {
  if (!allowRequest(request, "improve", 30)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: { taskId?: unknown; prompt?: unknown; custom?: unknown; output?: unknown; failedCheckIds?: unknown; rejected?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const resolved = resolveTask(body.taskId, body.custom);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const strings = (value: unknown, max: number) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 400)) : [];
  try {
    const step = await improveStep(
      resolved.task,
      body.prompt as string,
      typeof body.output === "string" ? body.output : "",
      strings(body.failedCheckIds, 12),
      strings(body.rejected, 8),
    );
    return NextResponse.json(step);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `This improvement step could not finish (${reason}).` }, { status: 502 });
  }
}
