// Release acceptance tests. Each expected outcome is written from the task, not from the code.
import { beforeAll, describe, expect, it } from "vitest";
import { scoreOutput } from "@/lib/checks";
import { buildCustomTask } from "@/lib/custom";
import { improveStep } from "@/lib/improve";
import { suggestChecks } from "@/lib/suggest";
import { getTask } from "@/lib/tasks";

beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});

const cfo = getTask("cfo-summary")!;
const lead = (answer: string) => scoreOutput(cfo, answer).checks.find((c) => c.id === "billing-first")!.pass;

describe("C. CFO ordering: the check must mean what its label says", () => {
  it("delivery named before billing does not pass", () => {
    expect(lead("Delivery delays and billing errors were the main issues.")).toBe(false);
  });
  it("billing first passes", () => {
    expect(lead("Billing errors caused duplicate charges. Deliveries were also late.")).toBe(true);
    expect(lead("Dana, the main concern is billing errors.")).toBe(true);
  });
  it("billing only near the end does not pass", () => {
    expect(lead("Deliveries ran late all month. Support was praised. Late in the month there were also billing errors.")).toBe(false);
  });
  it("a negated mention does not pass", () => {
    expect(lead("There were no billing problems worth noting. Deliveries were late.")).toBe(false);
  });
});

describe("A. Clarification uses what the user already said", () => {
  it("does not ask what kind of subject calculus is, and asks for a date as a date", async () => {
    const r = await suggestChecks("I want a full study guide with dates on what to do each day.", { prompt: "i want to study for calc 3 midterm" });
    const text = JSON.stringify(r).toLowerCase();
    expect(text).not.toMatch(/school subject|standardized|certification/);
    expect(r.questions.some((q) => q.type === "date")).toBe(true);
  });
});

describe("D. Improvement does not need a failed mechanical check", () => {
  it("proposes a revision for a qualitative goal with zero checks", async () => {
    const built = buildCustomTask({ goal: "A full study guide with a day-by-day schedule", material: "", checks: [] });
    if (!("task" in built)) throw new Error("no task");
    const step = await improveStep(built.task, "i want to study for calc 3 midterm", "Here are some tips.", [], [], ["The answer has no day-by-day schedule."]);
    expect(step.candidate).not.toBeNull();
    expect(step.candidate!.prompt.toLowerCase()).toContain("day-by-day");
  });
});

// ---------------------------------------------------------------------------
import { vi } from "vitest";
import { runCheck } from "@/lib/checks";
import { conclusion, sameContext } from "@/lib/compare";
import { MATCH_POLICY, composeGoal, resolveTask } from "@/lib/custom";
import { runTask, xrayTask } from "@/lib/engine";
import { informationGap, proposeRevision, safeguard } from "@/lib/improve";
import { buildModelInput } from "@/lib/model";
import { reviewGoal } from "@/lib/review";
import { neededQuestions } from "@/lib/suggest";
import type { BriefAnswer } from "@/lib/types";

const own = (input: object) => {
  const built = buildCustomTask(input);
  if (!("task" in built)) throw new Error(built.error);
  return built.task;
};

describe("A. Calculus clarification is stateful", () => {
  const prompt = "i want to study for calc 3 midterm";
  const goal = "I want a full study guide with dates on what to do each day.";

  it("asks only for what is missing: the exam date, the topics, the time available", () => {
    expect(neededQuestions(goal, { prompt }).map((q) => q.id)).toEqual(["target_date", "topics", "time_per_day"]);
  });

  it("returns at most two questions at a time and never repeats an answered or skipped one", async () => {
    const first = await suggestChecks(goal, { prompt });
    expect(first.questions.map((q) => q.id)).toEqual(["target_date", "topics"]);
    const answers: BriefAnswer[] = [
      { id: "target_date", question: "When is the exam?", type: "date", value: "2026-11-20" },
      { id: "topics", question: "Which topics does it cover?", type: "text", value: null },
    ];
    const second = await suggestChecks(goal, { prompt, answers });
    expect(second.questions.map((q) => q.id)).toEqual(["time_per_day"]);
    const third = await suggestChecks(goal, { prompt, answers: [...answers, { id: "time_per_day", question: "About how much time do you have each day?", type: "text", value: null }] });
    expect(third.questions).toEqual([]);
    expect(third.status).toBe("ready");
  });

  it("does not ask for a date the user already gave", () => {
    expect(neededQuestions(goal, { prompt: `${prompt} on November 20` }).map((q) => q.id)).not.toContain("target_date");
    expect(neededQuestions("Plan my week day by day, I have 2 hours each day, exam in 5 days", { prompt: "study plan for my test" }).map((q) => q.id)).toEqual(["topics"]);
  });

  it("a model question that rephrases an answered one is dropped", async () => {
    const model = await import("@/lib/model");
    const spy = vi.spyOn(model, "generateText").mockResolvedValue({
      text: JSON.stringify({ known: ["Subject: Calculus 3"], checks: [], qualitative: [], questions: [{ id: "exam_day", question: "When is the exam taking place?", type: "date" }, { id: "kind", question: "Is this a school subject or a certification?", type: "choice", options: ["School", "Certification"] }] }),
      model: "x",
      mock: false,
      complete: true,
    });
    try {
      const r = await suggestChecks(goal, { prompt, answers: [{ id: "target_date", question: "When is the exam?", type: "date", value: "2026-11-20" }] });
      expect(r.questions.some((q) => /when is the exam/i.test(q.question))).toBe(false);
      expect(r.questions.length).toBeLessThanOrEqual(2);
      expect(r.known).toEqual(["Subject: Calculus 3"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("stores a date as a date, keeps the goal text clean, and replaces a corrected answer", () => {
    const answers: BriefAnswer[] = [{ id: "target_date", question: "When is the exam?", type: "date", value: "2026-11-20" }];
    const composed = composeGoal(goal, answers);
    expect(composed.split("\n")[0]).toBe(goal);
    expect(composed).toContain("- When is the exam? 2026-11-20");
    const corrected = composeGoal(goal, [{ ...answers[0], value: "2026-11-22" }]);
    expect(corrected).toContain("2026-11-22");
    expect(corrected).not.toContain("2026-11-20");
  });

  it("a skipped date means an undated plan, and nothing is invented", () => {
    const composed = composeGoal(goal, [{ id: "target_date", question: "When is the exam?", type: "date", value: null }, { id: "topics", question: "Which topics does it cover?", type: "text", value: null }]);
    expect(composed).toMatch(/Do not invent these/);
    expect(composed).toMatch(/undated Day 1, Day 2/);
    expect(composed).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("B. Wording, approved variants, and topic coverage are three different things", () => {
  const check = (c: object) => own({ goal: "g", material: "", checks: [c] }).checks[0];

  it("the stated policy matches the implementation", () => {
    expect(MATCH_POLICY).toMatch(/Capitalization.*ignored/);
    const strict = check({ kind: "includes", text: "L'Hôpital" });
    expect(runCheck(strict, "use l’hôpital here").pass).toBe(true); // capitalization and quote style ignored
    expect(runCheck(strict, "use L'Hopital here").pass).toBe(false); // accents must match
    expect(runCheck(strict, "use LHopital here").pass).toBe(false);
    expect(strict.label).not.toMatch(/exact text/i);
  });

  it("an approved variant behaves the same in scoring and keeps the original requirement", () => {
    const relaxed = check({ kind: "includes", text: "L'Hôpital", alternatives: ["L'Hopital", "LHopital"] });
    expect(runCheck(relaxed, "use LHopital here").pass).toBe(true);
    expect(relaxed.label).toContain("L'Hôpital");
    expect(relaxed.label).toContain("LHopital");
  });

  it("a strict identifier or amount does not match inside a longer one, and is never fuzzy", () => {
    const id = check({ kind: "includes", text: "ABC-123" });
    expect(runCheck(id, "Ticket ABC-123 is open.").pass).toBe(true);
    expect(runCheck(id, "Ticket ABC-1234 is open.").pass).toBe(false);
    expect(runCheck(id, "Ticket ABC 123 is open.").pass).toBe(false);
    const amount = check({ kind: "includes", text: "$1,200" });
    expect(runCheck(amount, "It cost $1,200.").pass).toBe(true);
    expect(runCheck(amount, "It cost $1,2000.").pass).toBe(false);
    expect(runCheck(amount, "It cost $1200.").pass).toBe(false);
    const banned = check({ kind: "excludes", text: "budget" });
    expect(runCheck(banned, "The budgetary note stays.").pass).toBe(true);
    expect(runCheck(banned, "The budget stays.").pass).toBe(false);
  });

  it("a genuinely absent topic is not reported as an accent problem", async () => {
    const task = own({ goal: "A calculus study plan", material: "", checks: [{ kind: "includes", text: "L'Hôpital" }] });
    const { diagnose } = await import("@/lib/diagnose");
    const failed = [{ id: "c1", label: task.checks[0].label, pass: false, detail: "not found", category: "exact_text" as const }];
    const [absent] = diagnose(task, "Plan my calculus revision.", "Day 1: integrals. Day 2: series.", failed, []);
    expect(absent.evidence).not.toMatch(/differs only in accents/);
    expect(absent.evidence).toMatch(/appears nowhere/);
    const [variant] = diagnose(task, "Plan my calculus revision.", "Day 1: LHopital rule.", failed, []);
    expect(variant.evidence).toMatch(/differs only in accents, punctuation, or spacing/);
  });

  it("topic coverage is reviewed, not scored, and changing the matcher changes the context", async () => {
    const topic = own({ goal: "A study plan", material: "", checks: [], coverage: ["L'Hôpital's rule"] });
    expect(topic.checks).toEqual([]);
    expect(topic.goal).toMatch(/Topics the answer should cover \(reviewed, not scored by a rule\)/);
    const a = await runTask(own({ goal: "g", material: "", checks: [{ kind: "includes", text: "LHopital" }] }), "p");
    const b = await runTask(own({ goal: "g", material: "", checks: [{ kind: "includes", text: "LHopital", alternatives: ["L'Hôpital"] }] }), "p");
    expect(sameContext(a, b)).toBe(false);
    expect(conclusion(a, b)).toBeNull();
  });
});

describe("C. Other practice checks mean what they say", () => {
  const check = (id: string, answer: string) => scoreOutput(cfo, answer).checks.find((c) => c.id === id)!.pass;
  it("mentioning Friday is not the same as stating a Friday deadline", () => {
    expect(check("friday", "We spoke last Friday about deliveries.")).toBe(false);
    expect(check("friday", "A decision is needed by Friday.")).toBe(true);
  });
  it("mentioning $1,200 is not the same as giving it as the refund cost", () => {
    expect(check("refund-cost", "Late deliveries cost a customer $1,200 in lost sales.")).toBe(false);
    expect(check("refund-cost", "Refunds for billing errors cost $1,200 last month.")).toBe(true);
  });
  it("the word limit is the same number in the brief, the label, the edit, and the rule", () => {
    const words = cfo.checks.find((c) => c.id === "words")!;
    expect(cfo.situationCard.join(" ")).toContain("60 words or fewer");
    expect(words.label).toBe("60 words or fewer");
    expect(words.ghostClause).toBe("Use 60 words or fewer.");
    expect(runCheck(words, Array(60).fill("word").join(" ")).pass).toBe(true);
    expect(runCheck(words, Array(61).fill("word").join(" ")).pass).toBe(false);
  });
  it("a subject line is a line that starts with Subject:, not the word subject", () => {
    const subject = getTask("extension-email")!.checks.find((c) => c.id === "subject")!;
    expect(runCheck(subject, "Subject: Extension request\n\nDear Professor Lin").pass).toBe(true);
    expect(runCheck(subject, "Dear Professor Lin, on the subject of Assignment 3").pass).toBe(false);
  });
  it("the recorded landing answers score the same under the current checks", () => {
    const before = "Customers most often complained about late deliveries: four of eight comments mentioned delays, including one repeat issue and one missed gift occasion. Two reported billing or invoice errors that required follow-up to resolve. Support feedback was mixed but positive overall: two customers praised friendly, responsive service, while one had to contact support to fix a duplicate charge.";
    const after = "Billing errors, including duplicate charges and incorrect invoices, required refunds costing $1,200 last month. Delivery complaints also point to repeated delays, including missed promised dates and poor communication. Support feedback was positive. A decision is needed by Friday.";
    expect(scoreOutput(cfo, before).score).toBe(2);
    expect(scoreOutput(cfo, after).score).toBe(5);
  });
});

describe("D and E. Revision without mechanical checks, and when every check passes", () => {
  it("D: a qualitative goal with zero checks gets a complete candidate, and no number is invented", async () => {
    const task = own({ goal: "A full study guide with a day-by-day schedule", material: "", checks: [], brief: [{ id: "target_date", question: "When is the exam?", type: "date", value: null }] });
    const start = await runTask(task, "i want to study for calc 3 midterm");
    expect(start.total).toBe(0);
    const { proposal } = await proposeRevision(task, start.prompt, start.output, [], ["The answer has no day-by-day schedule."]);
    expect(proposal!.prompt).toContain("i want to study for calc 3 midterm");
    expect(proposal!.prompt).toMatch(/day-by-day schedule/);
    expect(proposal!.prompt).toMatch(/Do not invent/);
    const after = await runTask(task, proposal!.prompt);
    expect(after.total).toBe(0);
    expect(conclusion(start, after)).toMatch(/nothing was scored/);
  });

  it("E: the vendor email passes the checks, is flagged, and the proposal restores the task", async () => {
    const vendor = "Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.";
    const start = await runTask(cfo, vendor);
    const review = await reviewGoal(cfo, start.prompt, start.output);
    expect(review.findings[0].kind).toBe("task_mismatch");
    const { proposal } = await proposeRevision(cfo, vendor, start.output, [], review.findings.map((f) => f.what));
    expect(proposal!.prompt.startsWith("Summarize this customer feedback for our CFO.")).toBe(true);
    expect((await reviewGoal(cfo, proposal!.prompt, "x")).status).toBe("aligned");
  });

  it("a correct answer needs no revision", async () => {
    const r = await proposeRevision(cfo, "Summarize this customer feedback for our CFO. Lead with the billing errors. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday. Write one plain paragraph with no bullet points. Use 60 words or fewer.", "fine", [], []);
    expect(r.proposal).toBeNull();
    expect(r.note).toMatch(/nothing to revise/);
  });
});

describe("F. A correction keeps everything else the sentence carried", () => {
  it("one sentence with an audience, amount, deadline, and format survives a deliverable correction", async () => {
    const one = "Write to our billing vendor asking them to refund the $1,200 by Friday in one plain paragraph under 60 words.";
    const start = await runTask(cfo, one);
    const { proposal } = await proposeRevision(cfo, one, start.output, start.checks.filter((c) => !c.pass).map((c) => c.id), ["The prompt asks for a different deliverable."]);
    for (const detail of ["$1,200", "Friday", "60 words"]) expect(proposal!.prompt).toContain(detail);
    expect(proposal!.prompt).toMatch(/^Summarize this customer feedback for our CFO\./);
    expect(proposal!.restored.length).toBeGreaterThan(0);
  });

  it("the model's rewrite gets the same protection", () => {
    const original = "Email the team by Friday about the $40k budget freeze, under 80 words.";
    const guarded = safeguard(cfo, original, "Write a short note to the team about the budget freeze, due March 9.");
    expect(guarded.restored).toEqual(expect.arrayContaining(["Friday", "$40k", "80 words"]));
    expect(guarded.placeholders).toContain("March 9");
  });

  it("the goal is never sent to the generation model, and the gap is reported", () => {
    const task = own({ goal: "A summary that mentions the $40k budget and the March 3 launch", material: "Launch moved.", checks: [] });
    const sent = buildModelInput(task, "Summarize the notes.");
    expect(sent).not.toContain("$40k");
    expect(sent).toBe("Summarize the notes.\n\n---\nLaunch moved.");
    expect(informationGap(task, "Summarize the notes.")).toEqual(expect.arrayContaining(["$40k", "March 3"]));
    expect(informationGap(task, "Summarize the notes. Mention the $40k budget and March 3.")).toEqual([]);
  });
});

describe("G. Cut-off answers and partial reviews", () => {
  const cutOff = async (fn: () => Promise<void>) => {
    const model = await import("@/lib/model");
    const real = model.generate;
    const spy = vi.spyOn(model, "generate").mockImplementation(async (task, prompt) => {
      const reply = await real(task, prompt);
      return { ...reply, text: reply.text.slice(0, Math.floor(reply.text.length / 2)), complete: false };
    });
    try {
      await fn();
    } finally {
      spy.mockRestore();
    }
  };

  it("a cut-off answer is marked incomplete and a missing ending is not blamed on the prompt", async () => {
    await cutOff(async () => {
      const run = await runTask(cfo, "Summarize this customer feedback for our CFO. Lead with the billing errors. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday. Write one plain paragraph with no bullet points. Use 60 words or fewer.");
      expect(run.complete).toBe(false);
      const friday = run.diagnoses.find((d) => d.checkId === "friday");
      expect(friday!.kind).toBe("insufficient_evidence");
      expect(friday!.suggestedEdit).toBeNull();
      expect(friday!.interpretation).toMatch(/never written/);
    });
  });

  it("a complete short answer is marked complete", async () => {
    expect((await runTask(cfo, "Summarize this feedback.")).complete).toBe(true);
  });

  it("cut-off runs inside an X-ray are counted as failed, not as low scores", async () => {
    await cutOff(async () => {
      await expect(xrayTask(cfo, "Summarize this feedback. Use 60 words or fewer.", { runs: 1 })).rejects.toThrow(/cut off/);
    });
  });

  it("a reviewer that saw only part of an answer says so and makes no absence claim", async () => {
    const model = await import("@/lib/model");
    process.env.OPENAI_API_KEY = "sk-test";
    const seen: string[] = [];
    const spy = vi.spyOn(model, "generateText").mockImplementation(async (input) => {
      seen.push(input);
      return { text: JSON.stringify({ status: "concerns", summary: "s", findings: [{ kind: "missing_fact", what: "No Friday deadline.", why: "w" }, { kind: "off_topic", what: "Talks about weather.", why: "w" }] }), model: "x", mock: false, complete: true };
    });
    try {
      const review = await reviewGoal(cfo, "p", "A long answer that stops mid", false);
      expect(review.partial).toBe(true);
      expect(seen[0]).toMatch(/INCOMPLETE/);
      expect(review.findings.map((f) => f.kind)).toEqual(["off_topic"]);
      expect((await reviewGoal(cfo, "p", "x".repeat(20000), true)).partial).toBe(true);
      expect((await reviewGoal(cfo, "p", "A complete short answer.", true)).partial).toBe(false);
    } finally {
      spy.mockRestore();
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("truncated or malformed structured output is rejected, never read as a full analysis", async () => {
    const { parseReview } = await import("@/lib/review");
    const { parseSuggestion } = await import("@/lib/suggest");
    expect(parseReview('{"status":"aligned","summary":"ok","findings":[{"kind":"missing_fact","what":"x"', "p", "o")).toBeNull();
    expect(parseSuggestion('{"checks":[{"kind":"maxWords","value":80}')).toBeNull();
  });
});

describe("H and J. Experiment integrity and failure recovery", () => {
  it("the answer budget is part of the context, so runs under different limits are never compared", async () => {
    const standard = resolveTask("cfo-summary", undefined, false);
    const long = resolveTask("cfo-summary", undefined, true);
    if (!("task" in standard) || !("task" in long)) throw new Error("no task");
    const a = await runTask(standard.task, "Summarize.");
    const b = await runTask(long.task, "Summarize.");
    expect(sameContext(a, b)).toBe(false);
    expect(a.context.settings).not.toBe(b.context.settings);
  });

  it("answering a clarifying question changes the context, editing only the prompt does not", async () => {
    const base = { goal: "A study plan", material: "", checks: [] };
    const a = await runTask(own(base), "p1");
    const b = await runTask(own(base), "p2");
    const c = await runTask(own({ ...base, brief: [{ id: "target_date", question: "When is the exam?", type: "date", value: "2026-11-20" }] }), "p1");
    expect(sameContext(a, b)).toBe(true);
    expect(sameContext(a, c)).toBe(false);
  });

  it("a provider error during a proposal is an error, and a malformed reply falls back to rules", async () => {
    const model = await import("@/lib/model");
    process.env.OPENAI_API_KEY = "sk-test";
    const spy = vi.spyOn(model, "generateText").mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce({ text: "I cannot comply {", model: "x", mock: false, complete: true });
    try {
      await expect(proposeRevision(cfo, "Summarize this feedback.", "x", ["friday"], [])).rejects.toThrow(/rate limited/);
      const fallback = await proposeRevision(cfo, "Summarize this feedback.", "x", ["friday"], []);
      expect(fallback.proposal!.source).toBe("rules");
      expect(fallback.proposal!.prompt).toContain("Friday");
    } finally {
      spy.mockRestore();
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("failed requests in an X-ray are counted as failed and every run stays inspectable", async () => {
    const model = await import("@/lib/model");
    const real = model.generate;
    let n = 0;
    const spy = vi.spyOn(model, "generate").mockImplementation(async (task, prompt) => {
      if (++n % 3 === 0) throw new Error("rate limited");
      return real(task, prompt);
    });
    try {
      const xray = await xrayTask(cfo, "Summarize this feedback for our CFO. Use 60 words or fewer. Say that a decision is needed by Friday.", { runs: 3, maxParallel: 1 });
      expect(xray.failedCalls).toBeGreaterThan(0);
      expect(xray.trials.length).toBe(xray.modelCalls);
      expect(xray.trials.filter((t) => !t.ok).length).toBe(xray.failedCalls);
      expect(xray.ablations.filter((a) => a.core).length).toBe(1);
      expect(xray.ablations.find((a) => a.core)!.text).toMatch(/Summarize/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("D2. A goal the prompt never states", () => {
  const own = (goal: string) => {
    const built = buildCustomTask({ goal, material: "", checks: [] });
    if (!("task" in built)) throw new Error("no task");
    return built.task;
  };
  it("is carried into a proposal when no reviewer has cleared the answer", async () => {
    const task = own("A day-by-day study plan with one worked example per day");
    const r = await proposeRevision(task, "Help me study for calculus.", "Here are some tips.", [], [], [], true);
    expect(r.proposal?.prompt).toContain("day-by-day");
    expect(r.proposal?.prompt.startsWith("Help me study for calculus.")).toBe(true);
  });
  it("is not pushed when the reviewer found the answer aligned", async () => {
    const task = own("A day-by-day study plan with one worked example per day");
    const r = await proposeRevision(task, "Help me study for calculus.", "Day 1: limits, with a worked example.", [], [], [], false);
    expect(r.proposal).toBeNull();
  });
  it("is not triggered when the prompt already says it", async () => {
    const task = own("A day-by-day study plan with one worked example per day");
    const r = await proposeRevision(task, "Give me a day-by-day calculus study plan with one worked example each day.", "Day 1.", [], [], [], true);
    expect(r.proposal).toBeNull();
  });
});

describe("H2. X-ray segments are coherent experiments", () => {
  it("keeps a trailing modifier with the clause it modifies", async () => {
    const { segmentPrompt } = await import("@/lib/segment");
    const chunks = segmentPrompt("Summarize this for our CFO. Write one plain paragraph with no bullet points.").map((c) => c.text);
    expect(chunks).toEqual(["Summarize this for our CFO.", "Write one plain paragraph with no bullet points."]);
  });
  it("does not test an appositive on its own", async () => {
    const { segmentPrompt } = await import("@/lib/segment");
    const chunks = segmentPrompt("Summarize this feedback for Dana, the CFO, in one paragraph.").map((c) => c.text);
    expect(chunks.some((c) => /^the CFO,?$/.test(c))).toBe(false);
  });
});

describe("G2. Part of an answer cannot be declared fine", () => {
  it("an aligned verdict on a cut-off answer becomes unclear", async () => {
    const r = await reviewGoal(cfo, "Summarize this customer feedback for our CFO.", "Billing errors were", false);
    expect(r.partial).toBe(true);
    expect(r.status).not.toBe("aligned");
  });
});
