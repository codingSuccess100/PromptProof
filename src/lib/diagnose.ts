import { findVariant, foldLoose } from "./checks";
import { alternativesFor } from "./custom";
import { promptMentions } from "./ghost";
import type { CheckResult, Diagnosis, FrictionFinding, Task } from "./types";

// A failed check does not prove the prompt left something out.
// This sorts each failure into the most likely situation, using only things we can see:
// the prompt, the answer, and the check. It never guesses at the model's reasoning.

export function diagnose(
  task: Task,
  prompt: string,
  output: string,
  checks: CheckResult[],
  friction: FrictionFinding[],
): Diagnosis[] {
  const conflicts = friction.filter((f) => f.category === "conflicting_instructions");
  const found: Diagnosis[] = [];
  for (const spec of task.checks) {
    const result = checks.find((c) => c.id === spec.id);
    if (!result || result.pass) continue;
    const base = { checkId: spec.id, checkLabel: spec.label, observation: `The answer did not meet: ${spec.label}.`, evidence: `Check result: ${result.detail}.` };
    const asked = promptMentions(spec.promptCue, prompt);

    // 1. The answer has a close variant of an exact-text requirement.
    const nearMiss =
      spec.kind === "matches" && (spec.literals ?? []).find((literal) => foldLoose(literal).length > 2 && foldLoose(output).includes(foldLoose(literal)));
    if (nearMiss) {
      const written = findVariant(output, nearMiss);
      found.push({
        ...base,
        kind: "possible_checker_mismatch",
        evidence: `The check looks for the exact text "${nearMiss}". The answer ${written ? `wrote "${written}"` : "contains a close variant"}, which differs only in accents, punctuation, or spacing.`,
        interpretation:
          "The answer seems to cover this, and the check may be too literal. Is that exact spelling what you need? If so, keep it. If not, accept the other spelling. This check only tests that the text appears. It cannot tell whether the idea is explained correctly.",
        suggestedEdit: spec.ghostClause,
        alternatives: Array.from(new Set([...(written && written !== nearMiss ? [written] : []), ...alternativesFor(nearMiss)])).slice(0, 3),
      });
      continue;
    }

    // 1b. An exact-text requirement whose text appears nowhere in the user's own inputs.
    // Telling the model to emit it would pass the check without showing the topic was covered.
    const context = foldLoose(`${prompt} ${task.goal} ${task.sourceMaterial}`);
    const orphan = spec.kind === "matches" && (spec.literals ?? []).length > 0 && !(spec.literals ?? []).some((l) => context.includes(foldLoose(l)));
    if (orphan) {
      const literal = spec.literals![0];
      found.push({
        ...base,
        kind: "possible_checker_mismatch",
        evidence: `The check looks for the exact text "${literal}". That text appears nowhere in your prompt, goal, or notes, and not in the answer.`,
        interpretation:
          "An exact-text check shows that a string appears. It cannot show that a topic was covered or explained correctly. If you need this exact wording, keep it and tell the AI to include it. If you meant the topic, this check is the wrong tool: remove it and rely on the goal review, or accept the usual spelling.",
        suggestedEdit: spec.ghostClause,
        alternatives: alternativesFor(literal),
      });
      continue;
    }

    // 2. The prompt contains instructions that pull against each other.
    const lengthOrFormat = spec.kind === "maxWords" || spec.kind === "noListFormatting" || spec.kind === "numberedItemsExactly" || spec.kind === "onlyNumberedLines";
    if (conflicts.length > 0 && lengthOrFormat) {
      found.push({
        ...base,
        kind: "conflict",
        evidence: `${base.evidence} The prompt contains "${conflicts[0].phrase}".`,
        interpretation: `${conflicts[0].explanation} ${conflicts[0].suggestion}`,
        suggestedEdit: null,
      });
      continue;
    }

    // 3. The prompt already asks for this.
    if (asked) {
      found.push({
        ...base,
        kind: "present_not_followed",
        evidence: `${base.evidence} The prompt already appears to ask for this.`,
        interpretation:
          "Adding the same instruction again is unlikely to help. One thing to try is stating it on its own as a strict requirement, so it is not buried in a longer sentence. This is a suggestion, not a tested fix.",
        suggestedEdit: `This is a strict requirement: ${spec.ghostClause}`,
      });
      continue;
    }

    // 4. Nothing in the prompt asks for it.
    found.push({
      ...base,
      kind: "missing_instruction",
      evidence: `${base.evidence} Nothing in the prompt appears to ask for this.`,
      interpretation: "The model was not told. Adding the instruction is the direct thing to try. Whether it works is only known after a rerun.",
      suggestedEdit: spec.ghostClause,
    });
  }
  return found;
}
