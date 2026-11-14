import { beforeAll, describe, expect, it } from "vitest";
import { countWords, firstSentence, runCheck, scoreOutput } from "@/lib/checks";
import { labelAblation, runTask, xrayTask } from "@/lib/engine";
import { detectFriction } from "@/lib/friction";
import { segmentPrompt, withoutChunk } from "@/lib/segment";
import { TASKS, getTask, toPublicTask } from "@/lib/tasks";

// These tests run against the offline mock model, so they need no key and no network.
beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});

const cfo = getTask("cfo-summary")!;
const email = getTask("extension-email")!;
const items = getTask("action-items")!;

const STRONG: Record<string, string> = {
  "cfo-summary":
    "Summarize this feedback for our CFO. Lead with the billing errors. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday. Write one plain paragraph with no bullet points. Keep it under 60 words.",
  "extension-email":
    "Write an email to my professor asking for an extension. The course is CS 320. Ask to submit by Monday. Say I am 60% done. Keep the email under 80 words. Start with a subject line.",
  "action-items":
    "From these notes, include only Priya's action items. Use a numbered list. Output the list and nothing else, with no intro or closing line. Today is November 14, 2026. Mark anything past due with the word OVERDUE. Write each due date as YYYY-MM-DD.",
};

const LAZY: Record<string, string> = {
  "cfo-summary": "Summarize this feedback.",
  "extension-email": "Write an email to my professor asking for an extension.",
  "action-items": "List the action items.",
};

describe("deterministic checks", () => {
  it("counts words and ignores stray punctuation", () => {
    expect(countWords("One, two - three.")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });

  it("finds the first sentence", () => {
    expect(firstSentence("Billing is broken. Deliveries are late.")).toBe("Billing is broken.");
    expect(firstSentence("Here is a summary:\n- item")).toBe("Here is a summary:");
  });

  it("does not split $1,200 or miss it", () => {
    const spec = cfo.checks.find((c) => c.id === "refund-cost")!;
    expect(runCheck(spec, "Refunds cost $1,200 last month.").pass).toBe(true);
    expect(runCheck(spec, "Refunds cost $1200.").pass).toBe(true);
    expect(runCheck(spec, "Refunds were costly.").pass).toBe(false);
  });

  it("rejects bullets and multiple paragraphs for the plain paragraph check", () => {
    const spec = cfo.checks.find((c) => c.id === "plain-paragraph")!;
    expect(runCheck(spec, "One paragraph only.").pass).toBe(true);
    expect(runCheck(spec, "- a bullet").pass).toBe(false);
    expect(runCheck(spec, "Para one.\n\nPara two.").pass).toBe(false);
    expect(runCheck(spec, "").pass).toBe(false);
  });

  it("treats OVERDUE as case-sensitive", () => {
    const spec = items.checks.find((c) => c.id === "overdue")!;
    expect(runCheck(spec, "1. Send draft OVERDUE").pass).toBe(true);
    expect(runCheck(spec, "1. Send draft, which is overdue").pass).toBe(false);
  });

  it("counts numbered items and detects text outside the list", () => {
    const three = items.checks.find((c) => c.id === "three-numbered")!;
    const only = items.checks.find((c) => c.id === "list-only")!;
    const list = "1. a\n2. b\n3. c";
    expect(runCheck(three, list).pass).toBe(true);
    expect(runCheck(three, `${list}\n4. d`).pass).toBe(false);
    expect(runCheck(only, list).pass).toBe(true);
    expect(runCheck(only, `Here you go:\n${list}`).pass).toBe(false);
  });

  it("an empty output passes nothing that requires content", () => {
    for (const task of TASKS) {
      const { score } = scoreOutput(task, "");
      // Only "must not contain" style checks can pass on empty text.
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("segmentation", () => {
  it("splits the reference prompt into meaningful chunks", () => {
    const chunks = segmentPrompt(
      "You are an expert analyst. Summarize this feedback for our CFO under 100 words, put the top complaint first, mention the $1,200 refund.",
    ).map((c) => c.text);
    expect(chunks).toEqual([
      "You are an expert analyst.",
      "Summarize this feedback",
      "for our CFO",
      "under 100 words,",
      "put the top complaint first,",
      "mention the $1,200 refund.",
    ]);
  });

  it("never returns more than 8 chunks and loses no words", () => {
    const long = Array.from({ length: 14 }, (_, i) => `Do thing number ${i + 1} carefully.`).join(" ");
    const chunks = segmentPrompt(long);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks.map((c) => c.text).join(" ")).toBe(long);
  });

  it("removes exactly one chunk", () => {
    const chunks = segmentPrompt("Summarize this. Keep it under 60 words.");
    expect(withoutChunk(chunks, 1)).toBe("Summarize this.");
  });
});

describe("friction detector", () => {
  const find = (prompt: string) => detectFriction(prompt, segmentPrompt(prompt)).map((f) => f.category);

  it("flags persona language", () => {
    expect(find("You are a world-class expert analyst. Summarize this.")).toContain("persona");
  });
  it("flags a leading conclusion", () => {
    expect(find("Explain why our delivery partner is the worst.")).toContain("leading_assumption");
    expect(find("Obviously billing is the main problem. Summarize.")).toContain("leading_assumption");
  });
  it("flags conflicting instructions", () => {
    expect(find("Write a short but comprehensive summary.")).toContain("conflicting_instructions");
    expect(find("Keep it under 60 words. Aim for 200 words.")).toContain("conflicting_instructions");
    expect(find("No bullets. Give me a bulleted list.")).toContain("conflicting_instructions");
  });
  it("flags vague references", () => {
    expect(find("Summarize it like last time.")).toContain("vague_reference");
  });
  it("stays quiet on clean prompts", () => {
    for (const prompt of Object.values(STRONG)) expect(find(prompt)).toEqual([]);
    expect(find("Summarize this feedback for our CFO as one paragraph.")).toEqual([]);
  });
  it("links a finding to its chunk", () => {
    const prompt = "You are an expert analyst. Summarize this feedback.";
    const [finding] = detectFriction(prompt, segmentPrompt(prompt));
    expect(finding.chunkIndex).toBe(0);
  });
});

describe("tasks discriminate between lazy and strong prompts (mock model)", () => {
  for (const task of TASKS) {
    it(`${task.id}: lazy prompt scores 2 or less`, async () => {
      const result = await runTask(task, LAZY[task.id]);
      expect(result.score).toBeLessThanOrEqual(2);
      expect(result.ghosts.length).toBe(result.total - result.score);
      expect(result.mock).toBe(true);
    });
    it(`${task.id}: strong prompt scores 5 of 5`, async () => {
      const result = await runTask(task, STRONG[task.id]);
      expect(result.checks.filter((c) => !c.pass)).toEqual([]);
      expect(result.score).toBe(5);
      expect(result.ghosts).toEqual([]);
    });
  }

  it("every ghost clause, added to a lazy prompt, fixes its own check", async () => {
    for (const task of TASKS) {
      for (const spec of task.checks) {
        const result = await runTask(task, `${LAZY[task.id]} ${spec.ghostClause}`);
        const check = result.checks.find((c) => c.id === spec.id)!;
        // Two checks need a second requirement as well: "exactly 3 numbered items" also needs
        // the Priya filter, and "nothing but the list" also needs numbering.
        if (spec.id === "three-numbered" || spec.id === "list-only") continue;
        expect(check.pass, `${task.id}/${spec.id}`).toBe(true);
      }
    }
  });

  it("the public task never exposes the hidden checklist", () => {
    const pub = toPublicTask(email) as unknown as Record<string, unknown>;
    expect(pub.checks).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain("ghostClause");
  });
});

describe("X-ray ablation (mock model)", () => {
  it("decorative persona shows no measured effect, a requirement shows as helpful", async () => {
    const prompt = `You are a world-class expert analyst. ${STRONG["cfo-summary"]}`;
    const xray = await xrayTask(cfo, prompt);
    expect(xray.baselineScore).toBe(5);
    const persona = xray.ablations.find((a) => /expert analyst/.test(a.text))!;
    const words = xray.ablations.find((a) => /60 words/.test(a.text))!;
    expect(persona.label).toBe("no_measured_effect");
    expect(persona.delta).toBe(0);
    expect(words.label).toBe("helpful");
    expect(words.flippedChecks).toContain("words");
    expect(xray.modelCalls).toBe(1 + xray.ablations.length);
  });

  it("skips ablation for a single-chunk prompt", async () => {
    const xray = await xrayTask(email, "Email my professor");
    expect(xray.ablations).toEqual([]);
    expect(xray.modelCalls).toBe(1);
  });

  it("labels inconsistent repeat runs as uncertain", () => {
    expect(labelAblation([5, 5, 5], [5, 4, 5])).toBe("uncertain");
    expect(labelAblation([5, 5, 5], [4, 4, 3])).toBe("helpful");
    expect(labelAblation([3, 3], [3, 3])).toBe("no_measured_effect");
    expect(labelAblation([3], [4])).toBe("possibly_harmful");
    expect(labelAblation([5, 4, 5], [4, 5, 4])).toBe("uncertain");
  });
});
