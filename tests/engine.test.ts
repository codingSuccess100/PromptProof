import { beforeAll, describe, expect, it, vi } from "vitest";
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
      "Summarize this feedback for our CFO",
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

  it("the public task shows criteria in plain words but not the matching rules", () => {
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
    expect(xray.modelCalls).toBe(xray.runsPerChunk * (1 + xray.ablations.length));
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

import { buildCustomTask, cleanCheck, resolveTask } from "@/lib/custom";
import { mockSuggest, parseSuggestedChecks } from "@/lib/suggest";

describe("own-prompt mode", () => {
  const input = {
    material: "Notes: the launch moved to March 3. Budget is $40k.",
    checks: [
      { kind: "maxWords", value: 50 },
      { kind: "includes", text: "March 3" },
      { kind: "excludes", text: "budget" },
      { kind: "startsWith", text: "Update:" },
      { kind: "singleParagraph" },
    ],
  };

  it("builds rule-based checks and escapes user text", () => {
    const built = buildCustomTask({ material: "", checks: [{ kind: "includes", text: "$1,200 (net)" }] });
    expect("task" in built).toBe(true);
    if ("task" in built) {
      const spec = built.task.checks[0];
      expect(runCheck(spec, "Total was $1,200 (net) last month.").pass).toBe(true);
      expect(runCheck(spec, "Total was 1200 net.").pass).toBe(false);
    }
  });

  it("rejects empty, oversized, and malformed input", () => {
    expect("error" in buildCustomTask({ material: "", checks: [] })).toBe(true);
    expect("error" in buildCustomTask({ material: "x".repeat(7000), checks: [{ kind: "singleParagraph" }] })).toBe(true);
    expect("error" in buildCustomTask({ material: "", checks: [{ kind: "includes", text: "" }] })).toBe(true);
    expect(cleanCheck({ kind: "regex", text: ".*" })).toBeNull();
    expect(cleanCheck({ kind: "maxWords", value: -3 })).toBeNull();
    expect("error" in resolveTask("custom", undefined)).toBe(true);
    expect("error" in resolveTask("nope", undefined)).toBe(true);
  });

  it("a vague prompt fails and a specific prompt passes on the mock", async () => {
    const built = buildCustomTask(input);
    if (!("task" in built)) throw new Error("task did not build");
    const weak = await runTask(built.task, "Write an update.");
    expect(weak.score).toBeLessThanOrEqual(2);
    expect(weak.ghosts.length).toBeGreaterThan(0);
    const strong = await runTask(
      built.task,
      'Write an update. Use 50 words or fewer. Include "March 3". Do not mention "budget". Start with "Update:". Write one plain paragraph with no bullet points.',
    );
    expect(strong.score).toBe(5);
    const xray = await xrayTask(built.task, strong.prompt, { runs: 3 });
    expect(xray.runsPerChunk).toBe(3);
    expect(xray.ablations.some((a) => a.label === "helpful")).toBe(true);
    expect(xray.ablations.find((a) => /Write an update/.test(a.text))?.label).toBe("no_measured_effect");
  });

  it("parses suggested checks and drops invalid ones", () => {
    const reply = 'Sure: {"checks":[{"kind":"maxWords","value":80},{"kind":"includes","text":"Friday"},{"kind":"vibes"}]}';
    expect(parseSuggestedChecks(reply)).toEqual([
      { kind: "maxWords", value: 80 },
      { kind: "includes", text: "Friday" },
    ]);
    expect(parseSuggestedChecks("no json here")).toEqual([]);
    expect(mockSuggest('Under 80 words and must say "Friday"').length).toBe(2);
  });
});

import { apiKey, keyProblem, rawCall } from "@/lib/model";

describe("API key handling", () => {
  it("cleans quotes, spaces, and line breaks from the key", () => {
    process.env.OPENAI_API_KEY = ' "sk-test123"\r\n';
    expect(apiKey()).toBe("sk-test123");
    delete process.env.OPENAI_API_KEY;
    expect(apiKey()).toBe("");
  });

  it("explains a malformed key without calling the API or echoing it", async () => {
    expect(keyProblem("sk-abc def")).toMatch(/space/);
    expect(keyProblem("abc123")).toMatch(/sk-/);
    expect(keyProblem("sk-abc123")).toBeNull();
    const reply = await rawCall("hi", "sk-abc\ndef", "gpt-6-luna");
    expect(reply.status).toBe(0);
    expect(reply.note).toMatch(/API key/);
    expect(reply.note).not.toMatch(/sk-abc/);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the improvement pass. All run on the offline mock.
// ---------------------------------------------------------------------------
import { normalizeText } from "@/lib/checks";
import { compareChecks, conclusion, diffWords, sameContext } from "@/lib/compare";
import { alternativesFor, findContradiction } from "@/lib/custom";
import { labelFromChanges } from "@/lib/engine";
import { guardRevision, improveStep } from "@/lib/improve";
import { buildModelInput } from "@/lib/model";

const buildGoalOnly = (goal: string) => {
  const built = buildCustomTask({ material: "", checks: [], goal });
  if (!("task" in built)) throw new Error(built.error);
  return built.task;
};

const custom = (checks: unknown[], material = "", goal = "a goal") => {
  const built = buildCustomTask({ material, checks, goal });
  if (!("task" in built)) throw new Error(built.error);
  return built.task;
};

describe("comparison integrity", () => {
  const calculus = custom([{ kind: "includes", text: "LHopital" }]);
  const launch = custom(
    [
      { kind: "maxWords", value: 70 },
      { kind: "includes", text: "March 3" },
      { kind: "includes", text: "checkout bug" },
      { kind: "excludes", text: "$40k" },
      { kind: "singleParagraph" },
    ],
    "Launch moves to March 3 because of a checkout bug. Budget $40k.",
  );

  it("never compares a one-check calculus task with a five-check launch task", async () => {
    const a = await runTask(calculus, "Give me a calculus study guide.");
    const b = await runTask(launch, 'Write an update. Use 70 words or fewer. Include "March 3". Include "checkout bug". Write one plain paragraph with no bullet points.');
    expect(a.total).toBe(1);
    expect(b.total).toBe(5);
    expect(sameContext(a, b)).toBe(false);
    expect(conclusion(a, b)).toBeNull();
  });

  it("changing a requirement or the reference material creates a new context", async () => {
    const base = await runTask(launch, "Write an update.");
    const otherChecks = await runTask(custom([{ kind: "maxWords", value: 70 }], launch.sourceMaterial), "Write an update.");
    const otherMaterial = await runTask(custom([{ kind: "maxWords", value: 70 }], "Different notes."), "Write an update.");
    expect(new Set([base.contextId, otherChecks.contextId, otherMaterial.contextId]).size).toBe(3);
    expect((await runTask(launch, "A different prompt entirely.")).contextId).toBe(base.contextId);
  });

  it("two revisions in one context give correct prompt, output, and check differences", async () => {
    const before = await runTask(launch, "Write an update.");
    const after = await runTask(launch, 'Write an update. Use 70 words or fewer. Include "March 3". Include "checkout bug".');
    expect(sameContext(before, after)).toBe(true);
    const diff = compareChecks(before.checks, after.checks);
    expect(diff.improved.length).toBeGreaterThan(0);
    expect(diff.improved.length + diff.regressed.length + diff.unchangedPass.length + diff.unchangedFail.length).toBe(5);
    expect(conclusion(before, after)).toMatch(/more requirement/);
    expect(after.output).not.toBe(before.output);
    expect(diffWords(before.prompt, after.prompt).filter((t) => t.type === "added").length).toBeGreaterThan(3);
  });

  it("reports a trade and a regression instead of a net score", () => {
    const check = (id: string, pass: boolean) => ({ id, label: id, pass, detail: "", category: "format" as const });
    const diff = compareChecks([check("a", true), check("b", false)], [check("a", false), check("b", true)]);
    expect(diff.improved.map((c) => c.id)).toEqual(["b"]);
    expect(diff.regressed.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("evaluation integrity", () => {
  it("normalizes Unicode punctuation but keeps accents distinct", () => {
    expect(normalizeText("L’Hôpital rule — done")).toBe("L'Hôpital rule - done");
    const strict = custom([{ kind: "includes", text: "L'Hôpital" }]).checks[0];
    expect(runCheck(strict, "Use L’Hôpital’s rule.").pass).toBe(true);
    expect(runCheck(strict, "Use LHopital.").pass).toBe(false);
  });

  it("accepts an alternative spelling only when the user approved it", () => {
    expect(alternativesFor("L'Hôpital")).toEqual(expect.arrayContaining(["L'Hopital", "LHopital"]));
    const approved = custom([{ kind: "includes", text: "L'Hôpital", alternatives: ["LHopital"] }]).checks[0];
    expect(runCheck(approved, "Use LHopital.").pass).toBe(true);
    expect(runCheck(approved, "Use LHopital.").category).toBe("exact_text");
  });

  it("flags a near miss as a possible checker mismatch, not a missing instruction", async () => {
    const task = custom([{ kind: "includes", text: "LHopital" }]);
    const fake = [{ id: "c1", label: task.checks[0].label, pass: false, detail: "not found", category: "exact_text" as const }];
    const { diagnose } = await import("@/lib/diagnose");
    const [d] = diagnose(task, "Explain limits.", "Apply L'Hôpital's rule to 0/0 forms.", fake, []);
    expect(d.kind).toBe("possible_checker_mismatch");
    expect(d.alternatives).toBeDefined();
    expect(d.interpretation).toMatch(/cannot tell whether the idea is explained correctly/);
  });

  it("counts words, paragraphs, bullets, and numbered lists as documented", () => {
    expect(countWords("One — two, three! 4 été")).toBe(5);
    const para = custom([{ kind: "singleParagraph" }]).checks[0];
    expect(runCheck(para, "One paragraph only.").pass).toBe(true);
    expect(runCheck(para, "First.\n\nSecond.").pass).toBe(false);
    expect(runCheck(para, "- bullet\n- bullet").pass).toBe(false);
    expect(runCheck(para, "• bullet").pass).toBe(false);
    const list = custom([{ kind: "numberedItems", value: 2 }]).checks[0];
    expect(runCheck(list, "1. a\n2) b").pass).toBe(true);
    expect(runCheck(list, "1. a\n2. b\n3. c").pass).toBe(false);
  });

  it("an empty answer meets nothing, including must-not-mention rules", () => {
    const task = custom([{ kind: "excludes", text: "budget" }, { kind: "maxWords", value: 50 }]);
    expect(scoreOutput(task, "   ").score).toBe(0);
  });

  it("rejects contradictory and impossible requirements", () => {
    expect(findContradiction([{ kind: "includes", text: "March 3" }, { kind: "excludes", text: "march 3" }])).toMatch(/contradict/);
    expect(findContradiction([{ kind: "maxWords", value: 2 }, { kind: "includes", text: "one two three four" }])).toMatch(/over the 2 word limit/);
    expect(findContradiction([{ kind: "singleParagraph" }, { kind: "listOnly" }])).toMatch(/one format/);
    expect(findContradiction([{ kind: "maxWords", value: 50 }, { kind: "includes", text: "Friday" }])).toBeNull();
    expect("error" in buildCustomTask({ material: "", checks: [{ kind: "singleParagraph" }, { kind: "numberedItems", value: 3 }] })).toBe(true);
  });

  it("with a goal and no checks the run is unscored, and with neither it is refused", async () => {
    const unscored = custom([], "");
    expect(unscored).toBeDefined();
    const run = await runTask(buildGoalOnly("A comprehensive study plan"), "Help me study.");
    expect(run.total).toBe(0);
    expect(run.checks).toEqual([]);
    expect("error" in buildCustomTask({ material: "", checks: [] })).toBe(true);
    expect("error" in buildCustomTask({ material: "", checks: [], goal: "  " })).toBe(true);
  });

  it("the generation request never contains the scenario card or the rubric", () => {
    for (const task of TASKS) {
      const sent = buildModelInput(task, "Do the task.");
      for (const fact of task.situationCard) expect(sent).not.toContain(fact);
      for (const check of task.checks) {
        expect(sent).not.toContain(check.label);
        expect(sent).not.toContain(check.ghostClause);
      }
    }
  });
});

describe("X-ray integrity", () => {
  const change = (b: number, a: number) => ({ checkId: "x", label: "x", baselinePasses: b, ablatedPasses: a });
  it("labels from per-check pass counts", () => {
    expect(labelFromChanges([], 3, 3)).toBe("no_measured_effect");
    expect(labelFromChanges([change(3, 0)], 3, 3)).toBe("helpful");
    expect(labelFromChanges([change(0, 3)], 3, 3)).toBe("possibly_harmful");
    expect(labelFromChanges([change(3, 1)], 3, 3)).toBe("uncertain");
    expect(labelFromChanges([change(2, 0)], 3, 3)).toBe("uncertain");
    expect(labelFromChanges([], 3, 0)).toBe("not_tested");
  });

  it("equal totals with different checks is a tradeoff, not no effect", () => {
    expect(labelFromChanges([change(3, 0), { ...change(0, 3), checkId: "y" }], 3, 3)).toBe("tradeoff");
  });

  it("a zero-score baseline comes with a caution", async () => {
    const task = custom([{ kind: "includes", text: "LHopital" }]);
    const xray = await xrayTask(task, "I have a midterm for calculus in 5 days, and you please give me a study guide that I can use.", { runs: 3 });
    expect(xray.baselineScore).toBe(0);
    expect(xray.caution).toMatch(/says very little/);
    expect(xray.ablations.every((a) => a.label === "no_measured_effect")).toBe(true);
  });

  it("a failed request is recorded as failed, never as a zero score", async () => {
    const model = await import("@/lib/model");
    const real = model.generate;
    let n = 0;
    const spy = vi.spyOn(model, "generate").mockImplementation(async (task, prompt) => {
      n++;
      if (n % 4 === 2) throw new Error("rate limited");
      return real(task, prompt);
    });
    try {
      const xray = await xrayTask(cfo, STRONG["cfo-summary"], { runs: 3, maxParallel: 1 });
      expect(xray.failedCalls).toBeGreaterThan(0);
      const short = xray.ablations.filter((a) => a.failedRuns > 0);
      expect(short.length).toBeGreaterThan(0);
      for (const a of xray.ablations) expect(a.scores.length).toBe(a.validRuns);
    } finally {
      spy.mockRestore();
    }
  });

  it("overlapping instructions each show no change, which is why the note about overlaps exists", async () => {
    const prompt = `${STRONG["cfo-summary"]} Keep it under 60 words please.`;
    const xray = await xrayTask(cfo, prompt, { runs: 1 });
    const limits = xray.ablations.filter((a) => /60 words/.test(a.text));
    expect(limits.length).toBe(2);
    expect(limits.every((a) => a.label === "no_measured_effect")).toBe(true);
  });
});

describe("revision usefulness", () => {
  it("gives different suggestions for omitted, ignored, and conflicting instructions", async () => {
    const omitted = await runTask(cfo, "Summarize this feedback.");
    const missing = omitted.diagnoses.find((d) => d.checkId === "friday")!;
    expect(missing.kind).toBe("missing_instruction");
    expect(missing.suggestedEdit).toBe("Say that a decision is needed by Friday.");

    const { diagnose } = await import("@/lib/diagnose");
    const failed = cfo.checks.map((c) => ({ id: c.id, label: c.label, pass: c.id !== "words", detail: "84 words", category: "length" as const }));
    const [ignored] = diagnose(cfo, "Summarize this feedback in under 60 words.", "long answer", failed, []);
    expect(ignored.kind).toBe("present_not_followed");
    expect(ignored.suggestedEdit).toMatch(/^This is a strict requirement/);
    expect(ignored.suggestedEdit).not.toBe(missing.suggestedEdit);

    const conflictPrompt = "Give a brief but detailed and comprehensive summary.";
    const [clash] = diagnose(cfo, conflictPrompt, "long answer", failed, detectFriction(conflictPrompt, segmentPrompt(conflictPrompt)));
    expect(clash.kind).toBe("conflict");
    expect(clash.suggestedEdit).toBeNull();
  });

  it("a persona alone is not reported as a conflict or a failure cause", async () => {
    const run = await runTask(cfo, "You are an expert analyst. Summarize this feedback.");
    expect(run.diagnoses.every((d) => d.kind !== "conflict")).toBe(true);
  });
});

describe("improve and test", () => {
  it("blocks drift, invented facts, and no-op edits", () => {
    const original = "Summarize this feedback for our CFO under 60 words.";
    expect(guardRevision(cfo, original, original)).toMatch(/identical/);
    expect(guardRevision(cfo, original, "Write a poem about spring.")).toMatch(/dropped too much/);
    expect(guardRevision(cfo, original, `${original} Mention the $9,999 penalty.`)).toMatch(/9,999/);
    expect(guardRevision(cfo, original, `${original} Say that a decision is needed by Friday.`)).toBeNull();
  });

  it("proposes one edit, tests it fresh in the same context, and does not repeat a rejected edit", async () => {
    const start = await runTask(cfo, "Summarize this feedback for our CFO.");
    const failedIds = start.checks.filter((c) => !c.pass).map((c) => c.id);
    const step = await improveStep(cfo, start.prompt, start.output, failedIds, []);
    expect(step.blocked).toBeNull();
    expect(step.run!.contextId).toBe(start.contextId);
    expect(step.run!.prompt).not.toBe(start.prompt);
    expect(compareChecks(start.checks, step.run!.checks).improved.length).toBeGreaterThan(0);
    const again = await improveStep(cfo, start.prompt, start.output, failedIds, [step.candidate!.change]);
    expect(again.candidate!.change).not.toBe(step.candidate!.change);
  });

  it("stops when nothing is failing", async () => {
    const step = await improveStep(cfo, STRONG["cfo-summary"], "fine", [], []);
    expect(step.run).toBeNull();
    expect(step.blocked).toMatch(/already passes/);
  });
});

// ---------------------------------------------------------------------------
// Goal layer: suggestions, goal review, and the two reported failures.
// ---------------------------------------------------------------------------
import { findVariant } from "@/lib/checks";
import { findTensions } from "@/lib/custom";
import { unsupportedLiteral } from "@/lib/improve";
import { parseReview, reviewGoal } from "@/lib/review";
import { extractMechanical, parseSuggestion, suggestChecks } from "@/lib/suggest";

describe("suggest checks handles ordinary language", () => {
  it("clear mechanical requirements become proposed checks", async () => {
    const r = await suggestChecks("Under 80 words, include March 3, and use one paragraph.");
    expect(r.status).toBe("suggestions");
    expect(r.checks).toEqual(expect.arrayContaining([{ kind: "maxWords", value: 80 }, { kind: "includes", text: "March 3" }, { kind: "singleParagraph" }]));
    expect(r.clarify).toBeNull();
  });

  it("mixed goals keep the mechanical part and hand the rest to goal review", async () => {
    const r = await suggestChecks("Give me a clear study plan with examples and no more than 300 words.");
    expect(r.status).toBe("partial");
    expect(r.checks).toEqual([{ kind: "maxWords", value: 300 }]);
    expect(r.qualitative).toEqual(expect.arrayContaining(["clear", "with examples"]));
  });

  it("a vague goal gets a clarifying question and options, never a dead end", async () => {
    const r = await suggestChecks("A comprehensive study plan");
    expect(r.status).toBe("needs_clarification");
    expect(r.checks).toEqual([]);
    expect(r.clarify!.question).toMatch(/Comprehensive/);
    expect(r.clarify!.options.length).toBeGreaterThanOrEqual(2);
  });

  it("explaining a topic does not turn the topic into a required string", async () => {
    const r = await suggestChecks("Explain L\u2019H\u00f4pital\u2019s rule with examples");
    expect(r.checks).toEqual([]);
    expect(r.status).toBe("needs_clarification");
    expect(r.qualitative).toContain("with examples");
  });

  it("keeps an exact identifier the user asked to keep", () => {
    expect(extractMechanical("Keep the exact ticket ID ABC-123")).toEqual([{ kind: "includes", text: "ABC-123" }]);
  });

  it("reports a contradiction among proposals instead of hiding it", async () => {
    const r = await suggestChecks('One paragraph, and exactly 3 numbered steps.');
    expect(r.warning).toMatch(/one format/);
  });

  it("reads near-miss model output and rejects unreadable output", () => {
    const wrapped = parseSuggestion('```json\n{"checks":[{"kind":"max_words","value":80},{"kind":"MaxWords","value":80},{"kind":"vibes"}],"qualitative":["clear"],"clarify":null}\n```');
    expect(wrapped!.checks).toEqual([{ kind: "maxWords", value: 80 }]);
    expect(wrapped!.qualitative).toEqual(["clear"]);
    expect(parseSuggestion("I could not do that.")).toBeNull();
    expect(parseSuggestion("{not json}")).toBeNull();
    expect(parseSuggestion('{"checks":[],"clarify":{"question":"What length?","options":["Short","Long"]}}')!.clarify).toEqual({ question: "What length?", options: ["Short", "Long"] });
  });

  it("a provider failure is an error, not an unsupported goal", async () => {
    const model = await import("@/lib/model");
    const spy = vi.spyOn(model, "generateText").mockRejectedValue(new Error("the model timed out"));
    try {
      await expect(suggestChecks("A comprehensive study plan")).rejects.toThrow(/timed out/);
    } finally {
      spy.mockRestore();
    }
  });

  it("an unreadable model reply still keeps what the user stated outright", async () => {
    const model = await import("@/lib/model");
    const spy = vi.spyOn(model, "generateText").mockResolvedValue({ text: "Sorry, here you go!", model: "x", mock: false });
    try {
      expect((await suggestChecks("Under 80 words and one paragraph.")).checks.length).toBe(2);
      await expect(suggestChecks("A comprehensive study plan")).rejects.toThrow(/could not be read/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("goal review stays separate from rule-based checks", () => {
  const VENDOR = "Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.";

  it("the vendor-message prompt passes all five checks and is still flagged as a task mismatch", async () => {
    const run = await runTask(cfo, VENDOR);
    expect(run.score).toBe(5);
    const review = await reviewGoal(cfo, run.prompt, run.output);
    expect(review.status).toBe("concerns");
    expect(review.findings[0].kind).toBe("task_mismatch");
    expect(review.findings[0].promptEvidence).toMatch(/vendor/i);
    expect(review.findings[0].suggestedEdit).toBe("Summarize this customer feedback for our CFO.");
    expect(review.findings[0].editMode).toBe("replace");
    // The review never rewrites a mechanical result.
    expect(run.checks.every((c) => c.pass)).toBe(true);
  });

  it("an on-task prompt is not flagged, so no flaw is manufactured", async () => {
    const review = await reviewGoal(cfo, STRONG["cfo-summary"], "fine");
    expect(review.status).toBe("aligned");
    expect(review.findings).toEqual([]);
  });

  it("mentioning the CFO is not what decides the review", async () => {
    const review = await reviewGoal(cfo, "Email the vendor and cc our CFO asking for refunds.", "x");
    expect(review.status).toBe("concerns");
  });

  it("keeps only quotes that really appear, and the status follows the findings", () => {
    const prompt = "Write to the vendor about refunds.";
    const answer = "Dear vendor, please refund us.";
    const parsed = parseReview(
      JSON.stringify({ status: "aligned", summary: "s", findings: [{ kind: "recipient_changed", what: "Addressed to the vendor.", promptEvidence: "Write to the vendor", answerEvidence: "Dear CFO", why: "w", suggestedEdit: "Summarize for the CFO.", editMode: "replace" }, { kind: "nonsense", what: "" }] }),
      prompt,
      answer,
    )!;
    expect(parsed.status).toBe("concerns");
    expect(parsed.findings.length).toBe(1);
    expect(parsed.findings[0].promptEvidence).toBe("Write to the vendor");
    expect(parsed.findings[0].answerEvidence).toBeNull();
    expect(parseReview("not json", prompt, answer)).toBeNull();
  });

  it("no goal means no review, not a guess", async () => {
    const review = await reviewGoal({ ...cfo, goal: "" }, "x", "y");
    expect(review.status).toBe("unavailable");
  });
});

describe("calculus scenario: topic versus exact string", () => {
  const goal = "A comprehensive plan to study for my calculus test";
  const task = custom([{ kind: "includes", text: "LHopital" }, { kind: "maxWords", value: 60 }], "", goal);

  it("finds the spelling the answer actually used", () => {
    expect(findVariant("First review L\u2019H\u00f4pital\u2019s rule for limits.", "LHopital")).toBe("L'H\u00f4pital");
    expect(findVariant("Nothing relevant here.", "LHopital")).toBeNull();
  });

  it("asks whether the literal spelling is intended instead of calling it a missing instruction", async () => {
    const { diagnose } = await import("@/lib/diagnose");
    const failed = task.checks.map((c) => ({ id: c.id, label: c.label, pass: c.kind !== "matches", detail: "not found", category: "exact_text" as const }));
    const [d] = diagnose(task, "Help me study calculus.", "Day 2: L\u2019H\u00f4pital\u2019s rule.", failed, []);
    expect(d.kind).toBe("possible_checker_mismatch");
    expect(d.evidence).toContain("L'H\u00f4pital");
    expect(d.alternatives![0]).toBe("L'H\u00f4pital");
    expect(d.interpretation).toMatch(/Is that exact spelling what you need/);
  });

  it("the helper will not force an unsupported exact string into the prompt", async () => {
    const prompt = "I have a calculus midterm in 5 days. Give me a comprehensive study plan.";
    expect(unsupportedLiteral(task, prompt, ["c1"])).toEqual({ checkLabel: task.checks[0].label, literal: "LHopital" });
    const stepResult = await improveStep(task, prompt, "A plan about limits and derivatives.", ["c1"], []);
    expect(stepResult.run).toBeNull();
    expect(stepResult.needsChoice).toMatch(/Decide whether that spelling is acceptable|appears nowhere in your prompt/);
    // Once the user puts the text in their own prompt, it is their deliberate constraint.
    expect(unsupportedLiteral(task, `${prompt} Cover LHopital.`, ["c1"])).toBeNull();
  });

  it("warns that a short word limit may fight a request for depth, and leaves the choice to the user", () => {
    const notes = findTensions(goal, "Give me a study plan.", [{ kind: "maxWords", value: 60 }]);
    expect(notes[0]).toMatch(/comprehensive/);
    expect(notes[0]).toMatch(/Keep the limit if an outline is what you want/);
    expect(findTensions("A short reminder", "x", [{ kind: "maxWords", value: 60 }])).toEqual([]);
    expect(findTensions(goal, "x", [{ kind: "maxWords", value: 600 }])).toEqual([]);
  });

  it("accepting another spelling changes the evaluation context", async () => {
    const strict = await runTask(custom([{ kind: "includes", text: "LHopital" }], "", goal), "Study plan please.");
    const relaxed = await runTask(custom([{ kind: "includes", text: "LHopital", alternatives: ["L'H\u00f4pital"] }], "", goal), "Study plan please.");
    expect(sameContext(strict, relaxed)).toBe(false);
    expect(conclusion(strict, relaxed)).toBeNull();
  });
});

describe("helper guardrails beyond numbers", () => {
  it("blocks an invented name and allows one that is already in the user's inputs", () => {
    const original = "Summarize this feedback for our CFO under 60 words.";
    expect(guardRevision(cfo, original, `${original} Address it to Margaret personally.`)).toMatch(/Margaret/);
    expect(guardRevision(cfo, original, `${original} Address it to Dana.`)).toBeNull();
  });

  it("a revision that loses the audience is caught as drift", () => {
    const original = "Summarize this customer feedback for our CFO in one plain paragraph under 60 words.";
    expect(guardRevision(cfo, original, "Under 60 words.")).toMatch(/dropped too much/);
  });

  it("the X-ray says when one instruction carries several requirements", async () => {
    const xray = await xrayTask(cfo, "Summarize this feedback. Mention the $1,200 refund cost and that a decision is needed by Friday and keep it under 60 words.", { runs: 1 });
    expect(xray.ablations.some((a) => a.bundled.length >= 2)).toBe(true);
  });
});

describe("unsupported exact text is a question, and the sample goal is readable offline", () => {
  it("does not offer to add a string that exists only in the check", async () => {
    const task = custom([{ kind: "includes", text: "LHopital" }], "", "A comprehensive plan to study for my calculus test");
    const run = await runTask(task, "Give me a comprehensive study plan for calculus.");
    expect(run.diagnoses[0].kind).toBe("possible_checker_mismatch");
    expect(run.diagnoses[0].evidence).toMatch(/appears nowhere in your prompt, goal, or notes/);
    expect(run.diagnoses[0].interpretation).toMatch(/cannot show that a topic was covered/);
  });

  it("a fact that is in the notes is still a plain missing instruction", async () => {
    const task = custom([{ kind: "includes", text: "March 3" }], "Launch moves to March 3.", "An update");
    const run = await runTask(task, "Write an update.");
    expect(run.diagnoses[0].kind).toBe("missing_instruction");
  });

  it("reads required and forbidden text out of a plain sentence", () => {
    const checks = extractMechanical('Under 70 words, one paragraph. It includes "March 3" and "checkout bug", and never mentions $40k.');
    expect(checks).toEqual(
      expect.arrayContaining([
        { kind: "maxWords", value: 70 },
        { kind: "singleParagraph" },
        { kind: "includes", text: "March 3" },
        { kind: "includes", text: "checkout bug" },
        { kind: "excludes", text: "$40k" },
      ]),
    );
    expect(extractMechanical('Never mention "the budget".')).toEqual([{ kind: "excludes", text: "budget" }]);
  });
});
