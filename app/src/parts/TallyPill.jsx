// One Tally status, the same words everywhere (review item 5): tallyStatus() in src/js/49-tally-cloud.js decides
// Not set up / Offline since … / Connected – company not linked / N entries waiting / Connected & in sync.
const MARK = { ok: "● ", warn: "◐ ", bad: "○ " };

export function useTally(co) { return tallyStatus(co || null); }

export default function TallyPill({ co, prefix = "Tally: " }) {
  const t = tallyStatus(co || null);
  return <span className={"tag " + t.level} title={t.say} data-tally={t.state}>{MARK[t.level] + prefix + t.label}</span>;
}
