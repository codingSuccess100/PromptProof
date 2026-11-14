// Best-effort protection for the API key on a public demo URL.
// In-memory and per server instance, so it slows abuse rather than preventing it.
// Also set a spending cap on the API key itself.

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;

export function allowRequest(request: Request, bucket: string, limit: number): boolean {
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}
