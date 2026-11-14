// Browser acceptance journeys:  npm run journeys
//
// Needs the app running (npm run dev, or npm run build && npm start) and Chrome installed.
//   BASE=http://localhost:3000        where the app is
//   CHROME_PATH=...                   only if Chrome is not found automatically
//   TRUNC_BASE=http://localhost:3001  optional second server started with MOCK_TRUNCATE=1 (journey G in the browser)
//
// Writes screenshots and journeys.md to ./journey-output (ignored by Git). It types only the sample
// text below, so nothing personal is recorded. Each expectation is written from the user's task.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "journey-output";
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find((p) => p && existsSync(p));
if (!chrome) {
  console.error("Chrome was not found. Set CHROME_PATH to chrome.exe and run again.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
const check = (name, ok, seen = "") => results.push({ name, ok: Boolean(ok), seen: String(seen).replace(/\s+/g, " ").slice(0, 160) });

async function open(path, { w = 1440, h = 900, mobile = false, reduced = false, base = BASE } = {}) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  if (reduced) await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + path, { waitUntil: "networkidle0" });
  await sleep(400);
  return p;
}
const text = (p, sel = "body") => p.$eval(sel, (e) => e.innerText).catch(() => "");
const value = (p, sel) => p.$eval(sel, (e) => e.value).catch(() => "");
const clickText = (p, t) =>
  p.evaluate((t) => {
    const b = [...document.querySelectorAll("button, summary")].find((b) => b.textContent.trim().startsWith(t) && !b.disabled);
    if (b) b.click();
    return Boolean(b);
  }, t);
const type = async (p, sel, v) => {
  await p.click(sel);
  await p.keyboard.down("Control");
  await p.keyboard.press("KeyA");
  await p.keyboard.up("Control");
  await p.keyboard.press("Backspace");
  if (v) await p.type(sel, v);
};
const idle = async (p, ms = 30000) => {
  const t0 = Date.now();
  await sleep(300);
  let quiet = 0;
  // Finished means nothing is working for three checks in a row. Review and proposal run one after the other.
  while (Date.now() - t0 < ms) {
    quiet = (await p.$(".pulse")) ? 0 : quiet + 1;
    if (quiet >= 3) return;
    await sleep(200);
  }
};
const snap = async (p, name, sel) => {
  if (sel) await p.evaluate((s) => window.scrollTo(0, (document.querySelector(s)?.getBoundingClientRect().top ?? 0) + window.scrollY - 70), sel);
  await sleep(250);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 72 });
};
const own = async (p) => {
  await clickText(p, "Use my own prompt");
  await sleep(150);
};

const CALC_PROMPT = "i want to study for calc 3 midterm";
const CALC_GOAL = "I want a full study guide with dates on what to do each day.";
const VENDOR = "Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.";
const STRONG = "Summarize this customer feedback for our CFO in one plain paragraph with no bullet points. Use 60 words or fewer. Start with the billing errors, not the delivery complaints. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday.";

// A. Calculus clarification.
{
  const p = await open("/workspace");
  await own(p);
  await type(p, "#prompt", CALC_PROMPT);
  await type(p, "#goal", CALC_GOAL);
  await clickText(p, "Review proposed evaluation");
  await idle(p);
  const asked = await text(p, ".proposal");
  check("A1 does not ask what kind of subject calculus is", !/school subject|standardized|certification/i.test(asked), asked);
  check("A2 the date question opens a date entry", Boolean(await p.$('.clarify input[type="date"]')));
  check("A3 at most two questions at once", (await p.$$(".clarify")).length <= 2, `${(await p.$$(".clarify")).length} questions`);
  await p.$eval('.clarify input[type="date"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "2026-12-04");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(150);
  await p.evaluate(() => document.querySelector('.clarify input[type="date"]').closest(".clarify").querySelector(".btn").click());
  await idle(p);
  check("A4 the goal text is untouched by the answer", (await value(p, "#goal")) === CALC_GOAL, await value(p, "#goal"));
  check("A5 the date is stored as its own detail", /2026-12-04/.test(await text(p, ".brief-list")), await text(p, ".brief-list"));
  check("A6 the date is not asked again", !(await p.$('.clarify input[type="date"]')));
  await clickText(p, "Review proposed evaluation");
  await idle(p);
  check("A7 reviewing again does not pollute the goal or re-ask", (await value(p, "#goal")) === CALC_GOAL && !(await p.$('.clarify input[type="date"]')));
  await p.evaluate(() => document.querySelector(".brief-list .link").click());
  await sleep(200);
  await p.$eval('.clarify input[type="date"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "2026-12-11");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(150);
  await p.evaluate(() => document.querySelector('.clarify input[type="date"]').closest(".clarify").querySelector(".btn").click());
  await idle(p);
  const list = await text(p, ".brief-list");
  check("A8 correcting an answer replaces it", /2026-12-11/.test(list) && !/2026-12-04/.test(list), list);
  await snap(p, "a-clarification", ".proposal");
  // Skipping the date gives an undated plan, never an invented date.
  await p.evaluate(() => document.querySelector(".brief-list .link").click());
  await sleep(200);
  await clickText(p, "I do not have a date");
  await idle(p);
  check("A9 skipping the date records that nothing will be invented", /Skipped/.test(await text(p, ".brief-list")), await text(p, ".brief-list"));
  await clickText(p, "Run");
  await idle(p);
  check("A10 runs without answering every question", Boolean(await p.$(".result")));
  const cand = await value(p, "#candidate");
  check("A11 the proposed prompt keeps the subject and invents no calendar date", /calc/i.test(cand) && !/\b20\d\d-\d\d-\d\d\b|\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}\b/i.test(cand), cand);
  await p.close();
}

// B. Exact wording versus topic.
{
  const p = await open("/workspace");
  await own(p);
  await type(p, "#prompt", "Give me a calculus study guide.");
  await type(p, "#goal", "A study guide that covers limits");
  await p.evaluate(() => [...document.querySelectorAll("details.brief")].forEach((d) => (d.open = true)));
  await clickText(p, "Add a check");
  await sleep(150);
  await p.type(".req-row input[type=text]", "LHopital");
  check("B1 the matching policy is stated next to the check", /Capitalization, quote style, dash style, and spacing are ignored/.test(await text(p, ".req-list")), await text(p, ".req-list"));
  await clickText(p, "Run");
  await idle(p);
  await p.evaluate(() => document.querySelectorAll(".fixes details").forEach((d) => (d.open = true)));
  const fixes = await text(p, ".fixes");
  check("B2 asks once whether the wording or the topic is meant", /exact wording, or did you mean the topic/i.test(fixes), fixes);
  await clickText(p, "The topic");
  await sleep(300);
  check("B3 choosing the topic removes the score and keeps it for review", /Topic to cover, reviewed not scored: LHopital/.test((await text(p, ".brief-list")).replace(/\s+/g, " ")), await text(p, ".brief-list"));
  check("B4 changing a check starts a new experiment", !(await p.$(".compare")) && /New experiment|Earlier experiments/.test(await text(p)));
  await p.close();
}

// C and E. The CFO checks mean what they say, and passing checks do not hide a wrong task.
{
  const p = await open("/workspace");
  check("C1 the label says what is measured", /Billing is the first issue named/.test(await p.evaluate(() => document.body.textContent)));
  await type(p, "#prompt", STRONG);
  await clickText(p, "Run");
  await idle(p);
  check("C2 the on-task prompt passes all five", (await text(p, ".met")).replace(/\s+/g, " ").includes("5 of 5"), await text(p, ".met"));
  check("C3 a correct answer gets no revision pushed at it", !(await p.$("#candidate")), await text(p, ".fixes"));
  await type(p, "#prompt", VENDOR);
  await clickText(p, "Test my edited prompt");
  await idle(p);
  const fixes = await text(p, ".fixes");
  check("E1 all checks pass and a goal concern is still reported", (await text(p, ".met")).replace(/\s+/g, " ").includes("5 of 5") && /goal review raised a concern/i.test(fixes), fixes);
  check("E2 one complete proposed prompt, labeled untested", Boolean(await p.$("#candidate")) && /a proposal, not tested yet/.test(fixes));
  check("E3 one primary action", (await p.$$(".fixes .btn.primary")).length === 1);
  await snap(p, "e-wrong-task", ".fixes");
  await p.close();
}

// D, F, I. Qualitative-only improvement, preserved constraints, and the whole flow.
{
  const p = await open("/workspace");
  await own(p);
  await type(p, "#prompt", "Help me study for calculus.");
  await type(p, "#goal", "A day-by-day study plan with one worked example per day");
  await clickText(p, "Run");
  await idle(p);
  check("D1 a goal-only run shows no invented number", /unscored/i.test(await text(p, ".result")) && !/\d of \d/.test(await text(p, ".judgement")), await text(p, ".judgement"));
  const cand = await value(p, "#candidate");
  check("D2 a revision is proposed with zero rule-based checks", /day-by-day/i.test(cand), cand);
  check("D3 the candidate editor is multiline", (await p.evaluate(() => document.querySelector("#candidate")?.tagName)) === "TEXTAREA");
  await clickText(p, "Test revised prompt");
  await idle(p);
  check("D4 testing it shows both prompts and both answers", Boolean(await p.$(".compare")), (await text(p, ".compare")).slice(0, 150));
  check("D5 no numeric improvement is claimed for a qualitative task", !/up \d|\d of \d/.test(await text(p, ".compare .verdict, .compare .headline")), await text(p, ".compare .headline"));
  await snap(p, "d-qualitative", ".compare");
  await p.close();

  const q = await open("/workspace");
  const original = "Summarize this feedback for our CFO. Mention that refunds cost $1,200 last month and a decision is needed by Friday.";
  await type(q, "#prompt", original);
  await clickText(q, "Run");
  await idle(q);
  const c2 = await value(q, "#candidate");
  check("F1 the revision keeps the amount, the day, and the recipient", ["$1,200", "Friday", "CFO"].every((d) => c2.includes(d)), c2);
  check("F2 the revision is a complete prompt, not a fragment", c2.startsWith("Summarize this feedback for our CFO"), c2);
  check("F3 no Replace-my-opening-sentence control remains", !/Replace my opening sentence/.test(await text(q)));
  await snap(q, "f-proposed-prompt", ".fixes");
  await clickText(q, "Test revised prompt");
  await idle(q);
  const cmp = await text(q, ".compare");
  check("I1 comparison appears after one action", Boolean(await q.$(".compare")), cmp.slice(0, 160));
  check("I2 the tested prompt is now the draft, and can be undone", (await value(q, "#prompt")) === c2.trim() && /Undo last edit|Go back to the original prompt/.test(await text(q)));
  await snap(q, "i-compare", ".compare");
  await clickText(q, "Run the X-ray");
  await idle(q, 60000);
  const x = await text(q, ".xray");
  check("H1 X-ray leads with one finding", /^(The clearest result|Removing any single instruction|No run of)/.test((await text(q, ".xray .headline")).trim()), await text(q, ".xray .headline"));
  check("H2 X-ray says the visible answer is a separate run", /one separate run and is not counted here/.test(x));
  check("H3 every run can be inspected", (await q.$$(".trials tbody tr")).length >= 6, `${(await q.$$(".trials tbody tr")).length} rows`);
  check("H4 the task instruction is never offered for deletion", /never a candidate for deletion/.test(x));
  await snap(q, "h-xray", ".xray");
  // Experiment integrity: a different output limit is a different experiment.
  await q.evaluate(() => window.scrollTo(0, 0));
  await q.close();

  const h = await open("/workspace");
  await own(h);
  await type(h, "#prompt", "Help me study for calculus.");
  await type(h, "#goal", "A study plan");
  await clickText(h, "Run");
  await idle(h);
  await h.evaluate(() => document.querySelector(".check-row input").click());
  await sleep(300);
  check("H5 changing the output limit starts a new experiment", !(await h.$(".result")) || /New experiment/.test(await text(h)), (await text(h)).match(/New experiment[^.]*\./)?.[0] ?? "");
  await clickText(h, "Run");
  await idle(h);
  check("H6 results from different settings are not compared", !(await h.$(".compare")));
  await h.close();
}

// G. A cut-off answer (needs a second server started with MOCK_TRUNCATE=1).
if (process.env.TRUNC_BASE) {
  const p = await open("/workspace", { base: process.env.TRUNC_BASE });
  await type(p, "#prompt", "Summarize this feedback for our CFO.");
  await clickText(p, "Run");
  await idle(p);
  const body = await text(p, ".result");
  check("G1 the answer is marked incomplete", /This answer is incomplete/.test(body) && /cut off/.test(body), body.slice(0, 200));
  check("G2 the missing end is not blamed on the prompt", /cannot be judged fairly yet/.test(await text(p, ".fixes")) && !(await p.$("#candidate")), await text(p, ".fixes .headline"));
  check("G4 no score is counted for a cut-off answer, and the review does not call it fine", !(await p.$(".result .met")) && /Not counted/.test(body) && !/No concerns found/.test(body), body.slice(-260));
  check("G3 recovery is offered", /Allow long answers and start again/.test(body));
  await snap(p, "g-incomplete", ".result");
  await p.close();
} else {
  results.push({ name: "G cut-off answer in the browser", ok: null, seen: "skipped: start a second server with MOCK_TRUNCATE=1 and set TRUNC_BASE" });
}

// J. Failure recovery.
{
  const p = await open("/workspace");
  let runs = 0;
  let failPropose = true;
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    if (r.url().endsWith("/api/run") && r.method() === "POST") runs++;
    if (r.url().endsWith("/api/propose") && failPropose) {
      failPropose = false;
      return r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated failure." }) });
    }
    r.continue();
  });
  await type(p, "#prompt", "Summarize this feedback.");
  await p.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Run");
    b.click();
    b.click();
  });
  await idle(p);
  check("J1 a double click sends one request and shows one result", runs === 1 && (await p.$$(".result")).length === 1, `${runs} requests`);
  check("J2 a failed proposal says so and leaves the result usable", /A revised prompt could not be written/.test(await text(p, ".fixes")) && Boolean(await p.$(".result .answer")), await text(p, ".fixes .notice.error"));
  await clickText(p, "Try again");
  await idle(p);
  check("J3 retrying recovers", Boolean(await p.$("#candidate")));
  await type(p, "#prompt", "Summarize this feedback for the team.");
  const before = runs;
  await clickText(p, "Test my edited prompt");
  await sleep(60);
  await clickText(p, "Cancel");
  await sleep(900);
  check("J4 Cancel stops the run and keeps the earlier result", !(await p.$(".pulse")) && Boolean(await p.$(".result")) && runs === before + 1, await text(p, ".notice"));
  await clickText(p, "Test my edited prompt");
  await idle(p);
  check("J5 running again after a cancel works", Boolean(await p.$(".compare")) || Boolean(await p.$(".result")));
  await clickText(p, "Run the X-ray");
  await sleep(120);
  await p.select(".field select", "extension-email");
  await sleep(1500);
  check("J6 switching tasks during an analysis leaves no stray result", !(await p.$(".result")));
  await p.close();
}

// Interface: keyboard, phone, reduced motion, landing control.
{
  const p = await open("/workspace");
  await type(p, "#prompt", "Summarize this feedback for our CFO.");
  await p.keyboard.down("Control");
  await p.keyboard.press("Enter");
  await p.keyboard.up("Control");
  await idle(p);
  const ran = Boolean(await p.$(".result"));
  if (!ran) {
    await clickText(p, "Run");
    await idle(p);
  }
  await p.focus("#candidate").catch(() => {});
  const ring = await p.evaluate(() => { const e = document.querySelector("#candidate"); return Boolean(e) && (getComputedStyle(e).outlineStyle !== "none" || getComputedStyle(e).boxShadow !== "none"); });
  check("K1 the proposed prompt is reachable and shows focus", ring);
  await p.keyboard.press("Tab");
  const next = await p.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  check("K2 Tab from the proposed prompt lands on its action", /Test revised prompt/.test(next), next);
  await p.close();

  const m = await open("/workspace", { w: 390, h: 844, mobile: true });
  await type(m, "#prompt", VENDOR);
  await clickText(m, "Run");
  await idle(m);
  check("K3 phone: no sideways scroll", (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  check("K4 phone: the proposed prompt and its action are visible together", await m.evaluate(() => { const a = document.querySelector("#candidate"); const b = document.querySelector(".candidate .btn.primary"); return Boolean(a && b) && b.getBoundingClientRect().top - a.getBoundingClientRect().top < 760; }));
  await snap(m, "k-phone", ".fixes");
  await m.close();

  const r = await open("/workspace", { reduced: true });
  await type(r, "#prompt", "Summarize this feedback.");
  await clickText(r, "Run");
  await idle(r);
  check("K5 works with reduced motion", Boolean(await r.$(".result")));
  await r.close();

  const l = await open("/");
  const frame = () => l.evaluate(() => document.querySelector(".backdrop canvas")?.toDataURL().slice(-80) ?? "");
  const a1 = await frame();
  await sleep(900);
  const moving = a1 !== (await frame());
  await clickText(l, "Pause background");
  await sleep(300);
  const b1 = await frame();
  await sleep(900);
  check("K6 the landing motion control really pauses the background", moving && b1 === (await frame()));
  await snap(l, "k-landing");
  await l.close();
}

await browser.close();
const lines = ["# PromptProof browser journeys", "", `- Generated: ${new Date().toISOString()}`, `- App: ${BASE}`, "", "| Check | Result | Observed |", "|---|---|---|"];
for (const r of results) lines.push(`| ${r.name} | ${r.ok === null ? "SKIPPED" : r.ok ? "PASS" : "FAIL"} | ${r.seen.replace(/\|/g, "/")} |`);
lines.push("", `Page errors: ${errors.length ? errors.slice(0, 5).join("; ") : "none"}`);
writeFileSync(`${OUT}/journeys.md`, lines.join("\n") + "\n");
for (const r of results) console.log(`${r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  [${r.seen}]`}`);
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed, ${results.filter((r) => r.ok === null).length} skipped. Page errors: ${errors.length}. Saved ${OUT}/journeys.md`);
process.exit(failed || errors.length ? 1 : 0);
