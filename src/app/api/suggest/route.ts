import { NextResponse } from "next/server";
import { MAX_GOAL_CHARS } from "@/lib/custom";
import { allowRequest } from "@/lib/ratelimit";
import { suggestChecks } from "@/lib/suggest";
import type { ApiError, BriefAnswer, SuggestResult } from "@/lib/types";

export const dynamic = "force-dynamic";

// Turns an ordinary-language goal into proposed checks, goals left for review, or a clarifying question.
// A provider failure is reported as a failure. It is never presented as "your goal cannot be checked".
export async function POST(request: Request): Promise<NextResponse<SuggestResult | ApiError>> {
  if (!allowRequest(request, "suggest", 30)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: { goal?: unknown; prompt?: unknown; material?: unknown; answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length === 0) return NextResponse.json({ error: "Describe what you want from the answer first." }, { status: 400 });
  if (goal.length > MAX_GOAL_CHARS) return NextResponse.json({ error: `Keep the description under ${MAX_GOAL_CHARS} characters.` }, { status: 400 });
  try {
    const answers = (Array.isArray(body.answers) ? body.answers : [])
      .filter((a): a is BriefAnswer => !!a && typeof a === "object" && typeof (a as BriefAnswer).id === "string" && typeof (a as BriefAnswer).question === "string")
      .slice(0, 8)
      .map((a) => ({ id: a.id.slice(0, 40), question: a.question.slice(0, 200), type: a.type, value: typeof a.value === "string" ? a.value.slice(0, 600) : null }));
    return NextResponse.json(
      await suggestChecks(goal, {
        prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 2000) : "",
        material: typeof body.material === "string" ? body.material.slice(0, 6000) : "",
        answers,
      }),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The suggestion request failed (${reason}). Your text is unchanged. Try again, or add checks by hand.` }, { status: 502 });
  }
}
