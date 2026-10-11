// A page's tabs (clean-up batch 3, 11-Oct-2026): Arc's underlined tabs, one style on every page (styles/arc-clean.css).
// At most six show; the rest are under "More" at the end of the row, which is the chosen tab while one of them is open
// ("More · Budget"). On a phone the row stays on one line and scrolls sideways.
//   tabs: [[id, label, count?]]; value: the open tab; onPick(id); label: the row's name for screen readers (and tests);
//   attr: a data- attribute each tab carries with its id (e.g. "data-mis-tab").
import More from "./More.jsx";

export const MAX_TABS = 6;

export default function PageTabs({ tabs, value, onPick, label, attr, max = MAX_TABS, className = "" }) {
  const list = tabs.filter(Boolean);
  const shown = list.length > max ? list.slice(0, max) : list, rest = list.length > max ? list.slice(max) : [];
  const onRest = rest.find(([id]) => id === value);
  const a = (id) => (attr ? { [attr]: id } : {});
  return <nav className={("sbar " + className).trim()} aria-label={label} role="tablist">
    {shown.map(([id, l, n]) => <button key={id} role="tab" aria-selected={value === id} {...a(id)} onClick={() => onPick(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
    {rest.length > 0 && <More label={onRest ? "More · " + onRest[1] : "More"} align="start" data-tabs-more="" data-on={onRest ? "" : undefined}
      items={rest.map(([id, l, n]) => [n != null ? l + " (" + n + ")" : l, () => onPick(id), { role: "tab", "aria-selected": value === id, ...a(id) }])} />}
  </nav>;
}
