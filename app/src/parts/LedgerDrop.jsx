// Many ledgers missing from one read of Tally (migration 129, 29-Oct-2026; the owner: "FinCom must never quietly mark many
// ledgers gone"). The cloud marks nothing and asks, in ONE alert row (tally_alerts, kind summary, data.what "ledger_drop"):
// "<company>: Tally on NWS144 · anshul lists 404 ledgers, 36 fewer than before (…). If they were deleted in Tally, press
// Confirm; otherwise nothing changes." This is the answer, in the bell (Bell.jsx) and under the client's row on the Tally
// page (TallyCompanies.jsx): Confirm deleted (tally_ledger_drop_confirm: marked, the owner's name on each mark) or Keep
// (tally_ledger_drop_keep: nothing marked). Owners only; the cloud checks it again. A file of its own, fetched when shown.
import { useState } from "react";
import Button from "./Button.jsx";

export default function LedgerDrop({ x, where = "bell" }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [open, setOpen] = useState(false);
  const d = (x && x.data) || {}, names = [].concat(d.names || []);
  const owner = !!(window.S && S.account && S.account.me && S.account.me.role === "owner");
  if (!d.drop) return null;
  const act = (fn, kind) => async (ev) => {
    if (ev) ev.stopPropagation();
    setBusy(kind); setErr("");
    try {
      const r = await TCloud.rpc(fn, { p_drop: d.drop });
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      if (typeof toast === "function") toast(kind === "confirm" ? (r && r.marked != null ? r.marked : names.length) + " ledgers marked deleted." : "Kept: nothing changed.");
      if (typeof Rec === "object" && Rec.alertsLoad) await Rec.alertsLoad();
    } catch (e) {
      setErr(String((e && e.message) || e).replace(/^.*?ERROR:\s*/, "").slice(0, 300));
    } finally {
      setBusy("");
      if (typeof render === "function") render();
    }
  };
  return <div className={"ldrop ldrop-" + where} data-ledger-drop={d.drop} data-ledger-drop-where={where} onClick={(ev) => ev.stopPropagation()}>
    {where === "row" && <p className="note bad ldrop-text" data-ledger-drop-text="">{x.words}</p>}
    <div className="al-acts ldrop-acts">
      {owner ? <>
        <Button className="btn small danger" data-ledger-drop-confirm="" disabled={!!busy} onClick={act("tally_ledger_drop_confirm", "confirm")}>{busy === "confirm" ? "Marking…" : "Confirm deleted"}</Button>
        <Button className="btn small" data-ledger-drop-keep="" disabled={!!busy} onClick={act("tally_ledger_drop_keep", "keep")}>{busy === "keep" ? "Keeping…" : "Keep"}</Button>
      </> : <span className="note" data-ledger-drop-owner="">An owner of the firm confirms or keeps them.</span>}
      {names.length > 0 && <button className="linkbtn" aria-expanded={open} data-ledger-drop-show="" onClick={() => setOpen(!open)}>
        {open ? "Hide the ledgers" : "Show the " + names.length + " ledgers"}</button>}
    </div>
    {open && <ul className="note ldrop-names" data-ledger-drop-names="" style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 180, overflow: "auto", overflowWrap: "anywhere" }}>
      {names.map((n) => <li key={n}>{n}</li>)}</ul>}
    {err && <p className="note bad" data-ledger-drop-err="" style={{ margin: "6px 0 0" }}>{err}</p>}
  </div>;
}
