import type { PromptChunk } from "./types";

// Splits a prompt into roughly 4 to 8 meaningful instruction chunks.
// Rule-based on purpose: it is fast, free, and gives the same chunks every time,
// so an ablation result always refers to the same piece of text.

const MAX_CHUNKS = 8;

// Split after sentence punctuation, semicolons, and commas that are followed by a space,
// and at line breaks. "$1,200" stays whole because its comma has no space after it.
const PRIMARY_SPLIT = /(?<=[.!?;:])\s+|(?<=,)\s+|\s*\n+\s*/;

// Inside a long piece, start a new chunk before common "new instruction" openers.
const SECONDARY_SPLIT = new RegExp(
  "\\s+(?=(?:" +
    [
      "for (?:our|the|my|a|an)\\b",
      "to (?:our|the|my) \\w+",
      "under \\d",
      "in (?:under|fewer|less|no more)\\b",
      "no more than\\b",
      "using\\b",
      "with (?:a|an|no|the)\\b",
      "without\\b",
      "as (?:a|an|one)\\b",
      "(?:and|then) (?:put|mention|include|keep|make|end|start|use|write|add|lead|flag|list|give|say|mark|ask|open|begin|output|leave|only)\\b",
      "but\\b",
    ].join("|") +
    "))",
  "i",
);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function segmentPrompt(prompt: string): PromptChunk[] {
  const pieces = prompt
    .trim()
    .split(PRIMARY_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  let parts: string[] = [];
  for (const piece of pieces) {
    if (wordCount(piece) > 4) {
      const fragments = piece
        .split(SECONDARY_SPLIT)
        .map((p) => p.trim())
        .filter(Boolean);
      // A fragment under three words ("Keep it") is not an instruction on its own.
      // Fold it into the fragment that follows, or the one before if it is last.
      const kept: string[] = [];
      let carry = "";
      for (const fragment of fragments) {
        const text = carry ? `${carry} ${fragment}` : fragment;
        if (wordCount(text) < 3) {
          carry = text;
        } else {
          kept.push(text);
          carry = "";
        }
      }
      if (carry) {
        if (kept.length > 0) kept[kept.length - 1] = `${kept[kept.length - 1]} ${carry}`;
        else kept.push(carry);
      }
      parts.push(...kept);
    } else {
      parts.push(piece);
    }
  }

  // A one-word fragment is not an instruction on its own. Attach it to a neighbor.
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && wordCount(part) < 2) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`;
    } else {
      merged.push(part);
    }
  }
  if (merged.length > 1 && wordCount(merged[0]) < 2) {
    merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
  }
  parts = merged;

  // Too many chunks means too many model calls. Merge the shortest neighbors until we fit.
  while (parts.length > MAX_CHUNKS) {
    let best = 0;
    let bestSize = Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const size = wordCount(parts[i]) + wordCount(parts[i + 1]);
      if (size < bestSize) {
        bestSize = size;
        best = i;
      }
    }
    parts.splice(best, 2, `${parts[best]} ${parts[best + 1]}`);
  }

  return parts.map((text, index) => ({ index, text }));
}

/** The prompt with one chunk removed. */
export function withoutChunk(chunks: PromptChunk[], removeIndex: number): string {
  return chunks
    .filter((c) => c.index !== removeIndex)
    .map((c) => c.text)
    .join(" ")
    .trim();
}
