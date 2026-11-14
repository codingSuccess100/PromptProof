import { NextResponse } from "next/server";
import { SUGGEST_INSTRUCTIONS, mockSuggest, parseSuggestedChecks } from "@/lib/custom";
import { generateText } from "@/lib/model";
import { allowRequest } from "@/lib/ratelimit";
import type { ApiError, SuggestResult } from "@/lib/types";

export const dynamic = "force-dynamic";

// Turns a plain-language description into rule-based checks.
// This is the one place a model proposes requirements. The user reviews and edits them,
// and the scoring itself stays rule-based.
export async function POST(request: Request): Promise<NextResponse<SuggestResult | ApiError>> {
  if (!allowRequest(request, "suggest", 20)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: { goal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length < 8) return NextResponse.json({ error: "Describe what a good answer must do, in a sentence or two." }, { status: 400 });
  if (goal.length > 600) return NextResponse.json({ error: "Keep the description under 600 characters." }, { status: 400 });

  try {
    const reply = await generateText(`${SUGGEST_INSTRUCTIONS}\n\nDescription:\n${goal}`);
    const checks = reply ? parseSuggestedChecks(reply.text) : mockSuggest(goal);
    if (checks.length === 0) {
      return NextResponse.json(
        { error: "Nothing in that description can be checked by a rule. Add requirements by hand, such as a word limit or a phrase that must appear." },
        { status: 422 },
      );
    }
    return NextResponse.json({ checks, model: reply ? reply.model : "offline mock rules", mock: !reply });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Could not suggest requirements (${reason}). Add them by hand.` }, { status: 502 });
  }
}
