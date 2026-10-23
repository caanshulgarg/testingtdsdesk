// The meetings someone is in today (the host, or invited by their sign-in email), for Today and the bell: read when
// Today or the bell is opened (at most every five minutes) and when Meetings is drawn; never with the page itself.
const st = { list: null, at: 0, busy: false };
const signed = () => { try { return typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm && !Cloud.st.mfa; } catch (e) { return false; } };
export function refreshMeetings(force) {
  if (!signed() || st.busy || (!force && Date.now() - st.at < 300000)) return;
  st.busy = true; st.at = Date.now();
  Cloud.fn("fincom-call", { action: "meetings" }).then((j) => { setMeetings(j.upcoming || []); }, () => { /* nothing shown */ }).finally(() => { st.busy = false; });
}
export function setMeetings(upcoming) {
  st.list = (upcoming || []).filter((r) => r.mine); st.at = Date.now();
  try { if (typeof window.render === "function") window.render(); } catch (e) { /* */ }
}
// mine, open now or starting within the next 24 hours (a meeting for later, no time: not here)
export function soonMeetings(now = Date.now()) {
  return (st.list || []).filter((r) => r.status === "open" || (r.scheduled_at && Date.parse(r.scheduled_at) + (Number(r.minutes) || 30) * 60000 > now && Date.parse(r.scheduled_at) - now < 86400000));
}
export const meetWhen = (iso) => { try { return typeof fmtDateTime === "function" ? fmtDateTime(iso) : new Date(iso).toLocaleString("en-IN"); } catch (e) { return ""; } };
