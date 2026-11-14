import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Markdown from "@/components/Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("answer rendering", () => {
  it("renders LaTeX math inline and as blocks", () => {
    const out = html("Use \\(\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1\\) here.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\nAlso $f'(x) = 2x$ and \\[ a^2 + b^2 = c^2 \\]");
    expect(out.match(/class="katex"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(out).toContain("math-block");
    expect(out).not.toContain("\\frac");
  });

  it("leaves money alone", () => {
    const out = html("Refunds cost $1,200 last month and the budget is $40k.");
    expect(out).not.toContain("katex");
    expect(out).toContain("$1,200 last month and the budget is $40k.");
  });

  it("never injects HTML from an answer", () => {
    const out = html('<img src=x onerror="alert(1)"> **bold** <script>alert(2)</script>\n\n- item `code`');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
  });

  it("shows invalid LaTeX as written instead of failing", () => {
    expect(html("$$\\frac{1}{$$")).toContain("\\frac{1}{");
  });
});
