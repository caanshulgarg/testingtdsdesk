// A column heading with its filter button, for the tables whose filters are the old pop-up (src/js/23: colPopHtml):
// the purchase review table ("rev"), the bank statement ("bank") and sales ("sales"). The pop-up answers the button.
export default function ColHead({ t, k, label, cls }) {
  const on = colActive(t, k), open = S.colPop && S.colPop.t === t && S.colPop.k === k;
  return (
    <th className={cls}><span className="colh"><span>{label}</span>
      <span data-legacy="" style={{ display: "contents" }}>
        <button className={"colf" + (on ? " on" : "") + (open ? " open" : "")} data-colf={k} data-colt={t} aria-label={"Filter " + label} title={"Filter " + label} dangerouslySetInnerHTML={{ __html: FUNNEL }} />
      </span></span></th>
  );
}
