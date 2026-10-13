// Case law and circulars in tax answers and notice replies (the owner's rule of 13-Oct-2026: no citation from the model's
// memory). A citation is shown, or put in a draft, only when:
//   1. its page was found or read during this answer (the web search's results or the web fetch's pages), and
//   2. FinCom has the page's text (the web fetch's text, or FinCom fetching the page itself from a free public source) and
//      that text holds the case's name and the line quoted.
// Otherwise it is dropped and the point says "No verified case found for this point." The model refers to a citation in
// its text as [C:n] (n: its record_citation number); any other case name in the text that FinCom has not verified is
// taken out. Paid databases (Taxmann, SCC Online, Manupatra) are not used.
// Plain module: no Deno, no imports.

export type Citation = { n: number, case_name: string, court: string, date: string, citation: string, url: string, quote: string, point: string,
  authority: string, flags: string[], act: string };
export type Checked = Citation & { ok: boolean, why: string, label: string };

export const NO_CASE = "No verified case found for this point.";
export const LABEL = "Verify before filing";
// free public sources FinCom may fetch itself to check a page
export const FREE_SOURCES = /^https:\/\/([a-z0-9-]+\.)*(indiankanoon\.org|sci\.gov\.in|main\.sci\.gov\.in|[a-z]+hc\.(nic|gov)\.in|hcservices\.ecourts\.gov\.in|itat\.gov\.in|cestat\.gov\.in|gstat\.gov\.in|incometaxindia\.gov\.in|incometax\.gov\.in|cbic-gst\.gov\.in|cbic\.gov\.in|gst\.gov\.in|egazette\.gov\.in|taxinformation\.cbic\.gov\.in)(\/|$)/i;
export const PAID = /(taxmann|scconline|manupatra|lexisnexis|westlaw)\./i;

// text for comparing: lower case, no tags, entities, punctuation or extra spaces
export function norm(s: string): string {
  return String(s || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;|&ldquo;|&rdquo;/g, '"').replace(/&#39;|&apos;|&lsquo;|&rsquo;/g, "'")
    .toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9&]+/g, " ").replace(/\s+/g, " ").trim();
}
// the case's name is on the page: both parties' names (the words that matter), in that order or not
export function nameOnPage(caseName: string, page: string): boolean {
  const p = " " + norm(page) + " ";
  const sides = String(caseName || "").split(/\s+(?:v\.?|vs\.?|versus)\s+/i).map((x) => norm(x).replace(/\b(m s|the|ltd|limited|pvt|private|and|others|ors|anr|another|dcit|acit|ito|cit|pcit)\b/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!sides.length) return false;
  return sides.every((side) => { const w = side.split(" ").filter((x) => x.length >= 3); return w.length > 0 && w.every((x) => p.includes(" " + x + " ") || p.includes(" " + x)); });
}
export function quoteOnPage(quote: string, page: string): boolean {
  const q = norm(quote);
  return q.split(" ").length >= 5 && norm(page).includes(q);
}

// check each citation the model recorded; seen: the URLs found or read in this answer; pages: the text FinCom has for them
export async function verify(list: Citation[], seen: Set<string>, pages: Map<string, string>, fetchPage: (url: string) => Promise<string | null>): Promise<Checked[]> {
  const out: Checked[] = [];
  for (const c of list) {
    const url = String(c.url || "").trim();
    const bad = (why: string): Checked => ({ ...c, ok: false, why, label: LABEL });
    if (!url || !/^https:\/\//i.test(url)) { out.push(bad("no link")); continue; }
    if (PAID.test(url)) { out.push(bad("a paid database: not used")); continue; }
    const key = url.replace(/#.*$/, "");
    if (!seen.has(key) && !seen.has(url)) { out.push(bad("not found or read in this answer")); continue; }
    let text = pages.get(key) ?? pages.get(url) ?? null;
    if (text == null && FREE_SOURCES.test(url)) { try { text = await fetchPage(url); } catch { text = null; } if (text != null) pages.set(key, text); }
    if (text == null) { out.push(bad("the page could not be read to check it")); continue; }
    if (!nameOnPage(c.case_name, text)) { out.push(bad("the case's name is not on the page")); continue; }
    if (!quoteOnPage(c.quote, text)) { out.push(bad("the line quoted is not on the page")); continue; }
    out.push({ ...c, ok: true, why: "", label: LABEL });
  }
  return out;
}

// how a verified citation reads in an answer or a draft
export function cite(c: Checked): string {
  return c.case_name + " (" + [c.court, c.citation, c.date].filter(Boolean).join(", ") + ")" + (c.flags.length ? " [" + c.flags.join("; ") + "]" : "") + " - " + c.url;
}

// the text with [C:n] replaced by the verified citation, or "No verified case found for this point."; and any case name
// ("A v. B", "A vs B", "In re A") that is not a verified citation taken out
export function applyCitations(text: string, checked: Checked[]): { text: string, removed: string[] } {
  const by = new Map(checked.map((c) => [c.n, c]));
  const removed: string[] = [];
  let out = String(text || "").replace(/\[C:(\d+)\]/g, (_m, n) => { const c = by.get(Number(n)); if (c && c.ok) return cite(c); if (c) removed.push(c.case_name); return NO_CASE; });
  const okNames = checked.filter((c) => c.ok).map((c) => norm(c.case_name));
  out = out.replace(/No verified case found for this point\.\./g, NO_CASE);
  const W = "[A-Z][A-Za-z0-9&'().,\\-]*", J = "(?:" + W + "|of|and|&|the|for|de|du)";
  const CASE = new RegExp("((?:M\\/s\\.?\\s+)?" + W + "(?:\\s+" + J + "){0,8})\\s+(?:v\\.|vs\\.?|versus)\\s+(" + W + "(?:\\s+" + J + "){0,8})", "g");
  out = out.replace(CASE, (m) => {
    const n = norm(m);
    if (okNames.some((k) => n.includes(k) || k.includes(n))) return m;
    removed.push(m.trim());
    return "[case removed: not verified]";
  });
  return { text: out, removed };
}
