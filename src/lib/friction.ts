import type { FrictionCategory, FrictionFinding, PromptChunk } from "./types";

// Prompt friction detector.
// This is pattern detection, not measurement. It flags wording that MAY make a prompt
// less reliable. Whether a phrase actually changed the result is the X-ray's job.
// Rules are deliberately conservative: a missed warning is better than a false one.

interface Rule {
  category: FrictionCategory;
  categoryLabel: string;
  pattern: RegExp;
  explanation: string;
  suggestion: string;
}

const RULES: Rule[] = [
  {
    category: "persona",
    categoryLabel: "Role or persona",
    pattern:
      /\b(?:you are|you're|act as|acting as|pretend (?:to be|you are)|imagine you are|as)\s+(?:an?|the|my)?\s*(?:[\w-]+\s+){0,3}?(?:expert|analyst|writer|assistant|consultant|professor|guru|specialist|copywriter|editor|strategist|engineer|genius)\b/i,
    explanation:
      "A role is not a problem in itself. It can set tone, and it carries none of the facts the task needs. The X-ray shows whether it changed these checks.",
    suggestion: "Keep it if the tone matters to you. If a required detail is missing, add that first.",
  },
  {
    category: "leading_assumption",
    categoryLabel: "Potential leading assumption",
    pattern:
      /\b(?:obviously|clearly|undoubtedly|of course|as (?:we all|everyone) knows?|everyone knows|it is (?:obvious|clear) that)\b|\b(?:don't|doesn't|isn't|aren't|wouldn't) (?:you|it|that) (?:think|agree|true)\b|\b(?:explain|show|prove|confirm) (?:why|that|how) [^.?!]*\b(?:is|are|was|were) (?:the )?(?:best|worst|bad|terrible|wrong|better|superior|a failure|failing|useless)\b/i,
    explanation: "This wording states a conclusion before asking. A model tends to go along with the framing it is given.",
    suggestion: "Ask the question neutrally and let the answer come from the material.",
  },
  {
    category: "vague_reference",
    categoryLabel: "Ambiguous reference",
    pattern:
      /\b(?:the usual|like (?:last|before)(?: time)?|as (?:before|discussed|usual)|you know(?: what i mean)?|and so on|something like that|or whatever|kind of|sort of|some stuff|the stuff|the thing|make it (?:good|better|nice|pop))\b|\betc\b\.?/i,
    explanation: "The model has no way to know what this refers to, so it will guess.",
    suggestion: "Replace it with the specific thing you mean.",
  },
  {
    category: "emotionally_loaded",
    categoryLabel: "Potentially loaded framing",
    pattern:
      /!{2,}|\b(?:asap|urgent(?:ly)?|desperate(?:ly)?|or else|i(?:'ll| will) (?:be|get) fired|life or death|please please|super important|extremely important|very very)\b|\b[A-Z]{4,}(?:\s+[A-Z]{2,})+\b/,
    explanation: "Pressure and emphasis tell the model how you feel, not what a good answer looks like.",
    suggestion: "State the actual constraint, such as a deadline or a length limit.",
  },
];

function chunkIndexFor(phrase: string, chunks: PromptChunk[]): number | null {
  const needle = phrase.toLowerCase();
  const hit = chunks.find((c) => c.text.toLowerCase().includes(needle));
  if (hit) return hit.index;
  // A phrase can straddle two chunks. Fall back to the chunk holding its first word.
  const firstWord = needle.split(/\s+/)[0];
  const partial = chunks.find((c) => c.text.toLowerCase().includes(firstWord));
  return partial ? partial.index : null;
}

function findConflicts(prompt: string, chunks: PromptChunk[]): FrictionFinding[] {
  const findings: FrictionFinding[] = [];
  const conflict = (phrase: string, explanation: string, suggestion: string, anchor: string) =>
    findings.push({
      category: "conflicting_instructions",
      categoryLabel: "Conflicting constraints",
      phrase,
      explanation,
      suggestion,
      chunkIndex: chunkIndexFor(anchor, chunks),
    });

  const brief = prompt.match(/\b(?:brief|short|concise|succinct)\b/i);
  const deep = prompt.match(/\b(?:detailed|comprehensive|thorough|in[- ]depth|exhaustive)\b/i);
  if (brief && deep) {
    conflict(
      `${brief[0]} ... ${deep[0]}`,
      "These two instructions pull in opposite directions, so the model has to pick one.",
      "Decide which matters more, or give an exact length.",
      deep[0],
    );
  }

  const limits = Array.from(prompt.matchAll(/(\d+)\s*-?\s*words?\b/gi)).map((m) => m[1]);
  const distinct = Array.from(new Set(limits));
  if (distinct.length > 1) {
    conflict(
      distinct.map((n) => `${n} words`).join(" ... "),
      "The prompt gives more than one word limit.",
      "Keep a single length limit.",
      `${distinct[1]} word`,
    );
  }

  const noList = prompt.match(/\b(?:no|without) (?:bullets?|bullet points?|lists?)\b/i);
  if (noList) {
    const rest = prompt.replace(noList[0], " ");
    const wantsList = rest.match(/\b(?:bullet(?:ed)? (?:points?|list)|in bullets|as a list|numbered list)\b/i);
    if (wantsList) {
      conflict(
        `${noList[0]} ... ${wantsList[0]}`,
        "The prompt asks for a list and also forbids one.",
        "Choose one format.",
        wantsList[0],
      );
    }
  }

  return findings;
}

export function detectFriction(prompt: string, chunks: PromptChunk[]): FrictionFinding[] {
  const findings: FrictionFinding[] = [];
  for (const rule of RULES) {
    const match = prompt.match(rule.pattern);
    if (!match) continue;
    const phrase = match[0].trim();
    findings.push({
      category: rule.category,
      categoryLabel: rule.categoryLabel,
      phrase,
      explanation: rule.explanation,
      suggestion: rule.suggestion,
      chunkIndex: chunkIndexFor(phrase, chunks),
    });
  }
  return [...findings, ...findConflicts(prompt, chunks)];
}
