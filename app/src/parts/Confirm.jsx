// "Confirm once, keep, show only when needed" (review 18-21): the one shared piece every settings page and every choice
// uses, so all of them behave the same. The model is in src/js/60-choices.js (Drafts, choiceGet / choiceConfirm, …).
//
//   <Confirm id label stores>…</Confirm> — a section of settings: what the person changes in it is a draft until Save
//     (the footer: "Not saved yet" with Save and Don't save; after Save, "Saved · <time> · <who>"). stores says what the
//     section changes: "client", "parties", "firm", "books:<key,key>", "salescfg", "reading"; or custom={dirty, save,
//     discard} for a section with its own way of saving (the ledger check's ticks). Leaving the page with unsaved
//     changes asks "Save your changes?" (Drafts.onPage).
//   <ChoiceTag co k /> — beside a choice of Client setup: "guessed · Confirm" when FinCom filled it, ✔ when confirmed.
//   <BankLedger co acc /> — which Tally ledger a bank account is: chosen and confirmed once, then one line
//     "Tally ledger: HDFC BANK · Change"; asked again only for a new account, or when the ledger has gone from Tally.
import { useEffect, useRef, useState } from "react";

function useCapture(id) {
  const el = useRef(null);
  useEffect(() => {
    const box = el.current; if (!box) return;
    const on = () => Drafts.touch(id);
    const evs = ["keydown", "input", "change", "click", "focusout", "pointerdown"];
    evs.forEach((e) => box.addEventListener(e, on, true));
    return () => evs.forEach((e) => box.removeEventListener(e, on, true));
  }, [id]);
  return el;
}

export function SavedLine({ id, cid, dirty, empty }) {
  const rec = Drafts.savedRec(id, cid);
  if (dirty) return <span className="cfm-state unsaved" data-cfm-state="unsaved">Not saved yet</span>;
  if (rec) return <span className="cfm-state saved" data-cfm-state="saved">{"Saved · " + fmtDateTime(rec.at) + " · " + (rec.by || "this computer")}</span>;
  return <span className="cfm-state" data-cfm-state="none">{empty || "No changes"}</span>;
}

export function ConfirmFooter({ id, cid, label, saveText = "Save", empty }) {
  const dirty = Drafts.dirty(id);
  return <div className="cfm-foot" data-confirm-foot={id} aria-label={"Save " + (label || "")}>
    <SavedLine id={id} cid={cid} dirty={dirty} empty={empty} />
    <span className="cfm-btns">
      {dirty && <button type="button" className="btn small" data-cfm="discard" onClick={() => Drafts.discard(id)}>Don’t save</button>}
      <button type="button" className="btn small primary" data-cfm="save" disabled={!dirty} onClick={() => { if (Drafts.save(id)) toast((label || "Settings") + ": saved."); }}>{saveText}</button>
    </span>
  </div>;
}

// a section of settings with its draft and its footer
export default function Confirm({ id, label, stores = [], cid, custom, onSave, saveText, empty, children, className = "" }) {
  const c = cid === undefined ? S.coId : cid;
  Drafts.reg(id, { label, stores, cid: c, custom, onSave });
  const el = useCapture(id);
  return <div ref={el} className={"cfm-sec " + className} data-confirm={id}>
    {children}
    <ConfirmFooter id={id} cid={c} label={label} saveText={saveText} empty={empty} />
  </div>;
}

// beside a choice of Client setup: guessed (FinCom filled it) with Confirm, or confirmed (who and when, on hover)
export function ChoiceTag({ co, k, value }) {
  const c = choiceGet(co, k);
  if (!c || !c.value) return null;
  const by = c.by ? " by " + c.by : "", at = c.at ? " on " + fmtDateTime(c.at) : "";
  if (c.state === "confirmed") return <span className="cfm-ok" data-choice={k} data-choice-state="confirmed" title={"Confirmed" + by + at}>✔ confirmed</span>;
  return <span className="cfm-guess" data-choice={k} data-choice-state="guessed">
    <span className="tag warn" title={c.why ? "FinCom’s guess: " + c.why : "FinCom’s guess"}>guessed, confirm</span>{" "}
    <button type="button" className="linkbtn" data-choice-confirm={k} onClick={() => { choiceConfirm(co, k, value || c.value); toast("Confirmed: " + c.value + "."); render(); }}>Confirm</button>
  </span>;
}

// Which Tally ledger is this bank account?
export function BankLedger({ co, acc, compact }) {
  const [changing, setChanging] = useState(false);
  if (!co || !acc || !acc.id) return null;
  const c = bankLedgerChoice(co, acc), pid = "bankled:" + co.id + ":" + acc.id;
  const pick = Drafts.picks[pid];
  const ask = !c.value || c.gone || c.state !== "confirmed" || changing;
  const where = (acc.bank || "Bank") + (acc.last4 ? " ··" + acc.last4 : "") + (acc.ifsc ? " · " + acc.ifsc : "");
  if (!ask) return <div className="bk-ledline" data-bank-ledger={acc.id} data-state="confirmed">
    <span>Tally ledger: <b>{c.value}</b></span>{" · "}
    <button type="button" className="linkbtn" data-bank-ledger-change="" onClick={() => askConfirm({ title: "Change the Tally ledger of this bank account?", ok: "Change",
      body: "<p>" + esc(where) + " is posted to <b>" + esc(c.value) + "</b>" + (c.by ? ", confirmed by " + esc(c.by) + (c.at ? " on " + esc(fmtDateTime(c.at)) : "") : "") + ". Bank lines are posted to the ledger you choose next, once you confirm it. Lines already in Tally are not changed.</p>" })
      .then((ok) => { if (ok) setChanging(true); })}>Change</button>
    {!compact && c.by && <span className="note">{" · confirmed by " + c.by + (c.at ? " " + fmtDateTime(c.at) : "")}</span>}
  </div>;
  const sel = pick !== undefined ? pick : c.value && !c.gone ? exactLedger(c.value) || "" : "";
  const listed = hasLedgerList();
  const choose = (v) => { Drafts.pick(pid, { value: v, label: "the Tally ledger of " + where, cid: co.id, save: (x) => bankConfirmAccLedger(acc.id, x) }); FinComReact.redraw(); };
  const confirm = () => { const v = sel; if (!v) { toast("Choose the Tally ledger first."); return; } delete Drafts.picks[pid]; delete Drafts.secs[pid]; if (bankConfirmAccLedger(acc.id, v)) setChanging(false); };
  return <div className="bk-setup" data-bank-ledger={acc.id} data-state={c.gone ? "gone" : c.value ? c.state : "none"}>
    <div><b>{c.gone ? c.value + " is no longer in Tally. Choose again." : "Which Tally ledger is this bank account?"}</b>
      <div className="note">{where}{c.value && c.state === "guessed" && !c.gone ? " · FinCom’s guess: " + c.value + (c.why ? " (" + c.why + ")" : "") + ". Confirm it, or choose another." : ""}</div></div>
    {listed ? <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <select aria-label="Tally ledger for this bank account" key={sel} onChange={(ev) => choose(ev.target.value)} dangerouslySetInnerHTML={{ __html: ledgerOptions(sel, BANK_GROUPS) }} />
      <button type="button" className="btn small primary" data-bank-ledger-confirm="" disabled={!sel} onClick={confirm}>Confirm</button>
      {changing && <button type="button" className="btn small" onClick={() => { delete Drafts.picks[pid]; delete Drafts.secs[pid]; setChanging(false); }}>Cancel</button>}
      {sel && pick !== undefined && <span className="cfm-state unsaved" data-cfm-state="unsaved">Not saved yet</span>}
    </span> : <span className="note">{B() && B().ledgersLoading ? "Loading the ledger list…" : "Import the ledger list first."}</span>}
  </div>;
}
