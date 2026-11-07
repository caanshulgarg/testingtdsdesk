// Corporate › Resolutions & minutes (the designs "ROC documents": the document list, the board resolution editor, the
// minutes in SS-1's layout): the templates (templates/*.js), the company's documents (draft / final, store.js
// corp_documents), and the editor: its fields on the left, the live A4 preview on the right, With letterhead / Plain paper,
// Word (.docx) and PDF (the browser's Save as PDF of the same pages). Every template's wording is to be checked by a
// Company Secretary before use; the page says so.
import { useEffect, useState } from "react";
import Button from "../../parts/Button.jsx";
import { Card, Pick, Text } from "./parts.jsx";
import { canEdit, corpOf, dropDoc, saveDoc, saveProfile } from "./store.js";
import { GALLERY, MINUTES, TEMPLATES, VENUES, build, byKey, cond, logoOk, pictureKind, directorsOf, dirOf, fieldsOf, idOf, profileFor, quorum, realDirectors, snapshotOf, startValues, titleOf } from "./docModel.js";
import { withIds } from "./Profile.jsx";
import { GROUPS } from "./templates/index.js";
import Paper from "./Paper.jsx";
import { printPdf } from "./docPrint.js";
import { downloadWord } from "./docWord.js";
import { dueItems } from "./eforms.js";
import { nextBoard } from "./health.js";
import { isDirector } from "./profile.js";
import { dmy, today } from "./dates.js";
import { shown } from "./Profile.jsx";

const CLASS = { private: "Private, limited by shares", public: "Public company", opc: "One Person Company", section8: "Section 8 company", unlimited: "Unlimited company", govt: "Government company" };
export function letterOf(P, on) {
  const l = P.letterhead || {};
  return { on: !!on, name: P.name, cin: P.cin, address: P.office, phone: P.phone || "", email: l.email || P.email || "", website: P.website || "", logo: logoOk(l.logo) ? l.logo : "" };
}

function newDoc(co, P, tpl, extra) {
  const d = saveDoc(co.id, Object.assign({ template: tpl.key, title: tpl.title, kind: tpl.kind, status: "draft", fields: startValues(tpl, P), letterhead: tpl.kind !== "minutes" }, extra || {}));
  S.corpDoc = d.id; render();
  return d;
}

// one field of a template
// directors to pick: the real directors (not a KMP who is not one); one picked before who has ceased since stays listed
function Field({ f, v, set, P, disabled }) {
  const ds = realDirectors(P), was = f.type === "director" && dirOf(P, v), list = was && !ds.includes(was) ? ds.concat([was]) : ds;
  const opts = list.map((d) => [idOf(d), d.name + (d.din ? " · DIN " + d.din : "") + " · " + (d.desig || "Director") + (d.ceased ? " · ceased" : "")]);
  const attr = ["data-field", f.k];
  if (f.type === "date") return <label className="corp-f"><span>{f.label}</span><input type="date" disabled={disabled} data-field={f.k} value={v || ""} onChange={(e) => set(e.target.value)} /></label>;
  if (f.type === "choice") return <Pick label={f.label} value={v} options={f.options} onSave={set} attr={attr} disabled={disabled} />;
  if (f.type === "venue") return <Pick label={f.label} value={v || "office"} options={VENUES.map(([k, l]) => [k, l[0].toUpperCase() + l.slice(1)])} onSave={set} attr={attr} disabled={disabled} />;
  if (f.type === "director") return <Pick label={f.label} value={v} options={[["", "Choose"]].concat(opts)} onSave={set} attr={attr} disabled={disabled} />;
  if (f.type === "directors") return <fieldset className="corp-f wide" style={{ border: 0, padding: 0, margin: 0 }} data-field={f.k}><legend style={{ fontWeight: 500, marginBottom: 4 }}>{f.label}</legend>
    {ds.length ? ds.map((d) => { const id = idOf(d), on = (v || []).includes(id) || (!!d.din && (v || []).includes(d.din));
      return <label key={id} className="chk" style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--corp-ink)" }}><input type="checkbox" disabled={disabled} checked={on}
        onChange={(e) => set(e.target.checked ? (v || []).concat([id]) : (v || []).filter((x) => x !== id && x !== d.din))} /> <span>{d.name} <span className="corp-note">{"· " + (d.desig || "Director") + (d.din ? " · DIN " + d.din : "")}</span></span></label>; })
      : <span className="corp-note">Add the directors in Company profile first.</span>}</fieldset>;
  if (f.type === "lines") return <Text label={f.label} value={v} onSave={set} area rows={5} wide attr={attr} disabled={disabled} />;
  return <Text label={f.label} value={v} placeholder={f.ph} onSave={set} wide={f.k === "toAddr" || f.k === "fromAddr"} attr={attr} inputMode={f.type === "money" ? "decimal" : undefined} disabled={disabled} />;
}

function Checks({ tpl, P, model, v }) {
  const ds = realDirectors(P), q = model.quorum || quorum(P, {}), note = cond(tpl.note || "", P, v || {});
  return <section className="corp-card corp-card-body corp-checks" style={{ paddingTop: 14 }} data-doc-checks="">
    <div className="corp-eyebrow">Compliance check</div>
    {tpl.kind !== "notice" && <div><span data-mark="info">§</span><span>{tpl.kind === "minutes" ? "Minutes within 30 days of the meeting, each page initialled and the last signed by the Chairman (s.118, SS-1 para 7)" : "Power of the Board: " + tpl.law + " of the Companies Act, 2013"}</span></div>}
    <div data-quorum={q.ok ? "ok" : "short"}><span data-mark={q.ok ? "ok" : "warn"}>{q.ok ? "✓" : "!"}</span><span>{ds.length < 2 ? "Fewer than two directors in the profile: a board meeting needs two at least (s.174)" : "Quorum: " + q.present + " of " + q.total + " directors, " + q.need + " needed (section 174)"}</span></div>
    {model.missing.length > 0 && <div data-doc-missing={model.missing.length}><span data-mark="warn">!</span><span>{"Still to fill in: " + model.missing.join(", ")}</span></div>}
    {(model.warn || []).map((w, i) => <div key={i} data-doc-warn={i}><span data-mark="warn">!</span><span>{w}</span></div>)}
    {note && <div><span data-mark="info">i</span><span>{note}</span></div>}
    <div><span data-mark="info">i</span><span>Template wording to be checked by a Company Secretary before use.</span></div>
  </section>;
}

function MinutesForm({ co, P, doc, set, disabled }) {
  const v = doc.fields || {}, ds = realDirectors(P), att = v.attendance || {}, q = quorum(P, att);
  const [adding, setAdding] = useState(false), [openItem, setOpenItem] = useState(-1);
  const items = v.items || [], off = v.off || [];
  const setItems = (x) => set({ items: x });
  return <>
    <Card title="Attendance" aside={<span className="corp-chip" data-tone={q.ok ? "ok" : "warn"} data-quorum-chip="">{q.ok ? "Quorum met · " + q.present + " of " + q.total : "No quorum · " + q.present + " of " + q.need + " needed"}</span>}>
      {ds.map((d) => { const id = idOf(d); return <div key={id} className="corp-row" style={{ flexWrap: "nowrap" }} data-attend={id}>
        <span style={{ flex: 1, minWidth: 0 }}>{d.name}<br /><span className="corp-note">{(d.desig || "Director") + (v.chairman === id ? " · Chairman" : "")}</span></span>
        <select aria-label={"Attendance of " + d.name} disabled={disabled} value={att[id] || att[d.din] || "In person"} onChange={(e) => set({ attendance: Object.assign({}, att, { [id]: e.target.value }) })}>{MINUTES.attendance.map((x) => <option key={x}>{x}</option>)}</select></div>; })}
      <Pick label="Chairman of the meeting" value={v.chairman} onSave={(x) => set({ chairman: x })} options={[["", "Choose"]].concat(ds.map((d) => [idOf(d), d.name]))} attr={["data-field", "chairman"]} disabled={disabled} />
    </Card>
    <Card title="Business transacted">
      {MINUTES.standard.map((s) => <div key={s.k} className="corp-row" style={{ justifyContent: "space-between" }} data-std={s.k}>
        <span style={{ opacity: off.includes(s.k) ? 0.5 : 1 }}>{s.title}</span>
        {s.fixed ? <span className="corp-chip">STANDARD</span> : <button className="linkbtn" disabled={disabled} onClick={() => set({ off: off.includes(s.k) ? off.filter((x) => x !== s.k) : off.concat([s.k]) })}>{off.includes(s.k) ? "Put back" : "Leave out"}</button>}</div>)}
      {items.map((it, i) => { const t = byKey(it.template); if (!t) return null; return <div key={i} data-item={i} style={{ borderTop: "1px solid var(--corp-soft)", paddingTop: 8 }}>
        <div className="corp-row" style={{ justifyContent: "space-between" }}><span><b>{t.title}</b> <span className="corp-note">{"· " + t.law}</span></span>
          <span className="corp-row"><button className="linkbtn" onClick={() => setOpenItem(openItem === i ? -1 : i)}>{openItem === i ? "Done" : disabled ? "View" : "Edit"}</button>
            <button className="linkbtn" disabled={disabled} aria-label={"Remove " + t.title} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button></span></div>
        {openItem === i && <div className="corp-grid" style={{ marginTop: 8 }}>{t.fields.map((f) => <Field key={f.k} f={f} P={P} disabled={disabled} v={(it.fields || {})[f.k]}
          set={(x) => setItems(items.map((z, j) => (j === i ? Object.assign({}, z, { fields: Object.assign({}, z.fields, { [f.k]: x }) }) : z)))} />)}</div>}
      </div>; })}
      {adding ? <div className="corp-tiles" data-add-business="">{TEMPLATES.filter((t) => t.kind === "resolution").map((t) => <button key={t.key} className="corp-tile" data-add-template={t.key}
        onClick={() => { const sv = startValues(t, P), f = {}; t.fields.forEach((x) => { f[x.k] = sv[x.k]; }); setItems(items.concat([{ template: t.key, fields: f }])); setAdding(false); setOpenItem(items.length); }}>
        <b>{t.title}</b><small>{t.law}</small></button>)}</div>
        : <Button className="btn small" disabled={disabled} data-add-business-open="" onClick={() => setAdding(true)}>+ Add business from templates</Button>}
    </Card>
  </>;
}

function Editor({ co, P, doc }) {
  const tpl = byKey(doc.template), [pages, setPages] = useState([[]]), [busy, setBusy] = useState("");
  if (!tpl) return <div className="corp-card corp-empty">This document's template is not known here.</div>;
  // a viewer, or a page whose copy is not in, only looks (and downloads)
  // a Final document: drawn from the snapshot kept when it was marked Final, and nothing in it changes
  const may = canEdit(co.id), v = doc.fields || {}, final = doc.status === "final", ro = final || !may;
  const P0 = P; P = profileFor(doc, P0);
  const letter = letterOf(P, doc.letterhead !== false), model = build(doc, P0, co);
  const owner = String((typeof Cloud === "object" && Cloud.st && Cloud.st.role) || "") === "owner";
  const set = (patch) => saveDoc(co.id, { id: doc.id, fields: Object.assign({}, v, patch), title: tpl.kind === "minutes" ? "Minutes of board meeting" + ((patch.serial || v.serial) ? " " + (patch.serial || v.serial) : "") : doc.title });
  const name = (P.name || co.name) + " - " + model.title + (v.meetingDate ? " " + dmy(v.meetingDate) : "");
  const addToMinutes = () => {
    const c = corpOf(co.id), m = c.docs.find((d) => d.template === "minutes" && d.status === "draft" && (d.fields || {}).meetingDate === v.meetingDate);
    const item = { template: tpl.key, fields: Object.fromEntries(tpl.fields.map((f) => [f.k, v[f.k]])) };
    if (m) { saveDoc(co.id, { id: m.id, fields: Object.assign({}, m.fields, { items: (m.fields.items || []).concat([item]) }) }); S.corpDoc = m.id; render(); }
    else { const sv = startValues(MINUTES, P); newDoc(co, P, MINUTES, { fields: Object.assign(sv, { meetingDate: v.meetingDate, meetingTime: v.meetingTime, venue: v.venue, place: v.place, items: [item] }) }); }
  };
  const word = async () => { setBusy("word"); try { await downloadWord(model, letter, name); } catch (e) { if (typeof toast === "function") toast(String((e && e.message) || e)); } finally { setBusy(""); } };
  const meetFields = fieldsOf(tpl).filter((f) => !tpl.fields.includes(f));
  return <div data-corp-editor={doc.id} data-template={tpl.key} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <nav aria-label="Breadcrumb" className="corp-note"><button className="linkbtn" data-doc-back="" onClick={() => { S.corpDoc = ""; render(); }}>Documents</button>{" › " + (tpl.kind === "minutes" ? "Meetings" : tpl.kind === "notice" ? "Notices" : "Board resolutions")}</nav>
        <div className="corp-row"><h1 style={{ fontSize: 24 }}>{model.title}</h1><span className="corp-chip" data-tone={final ? "ok" : ""} data-doc-status={doc.status}>{final ? "Final" : "Draft"}{doc.at ? " · saved " + new Date(doc.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
      </div>
      <div className="corp-row">
        {may && tpl.kind === "resolution" && <Button className="btn" data-doc-add-minutes="" onClick={addToMinutes}>Add to minutes</Button>}
        {may && tpl.kind === "minutes" && <Button className="btn" onClick={() => { const nt = byKey("board-notice"); const sv = startValues(nt, P); newDoc(co, P, nt, { fields: Object.assign(sv, { meetingDate: v.meetingDate, meetingTime: v.meetingTime, venue: v.venue, place: v.place, serial: v.serial,
          agenda: sv.agenda.split("\n").slice(0, 3).concat((v.items || []).map((it) => { const t = byKey(it.template); return t ? "To consider " + t.title.toLowerCase() : ""; }).filter(Boolean)).concat(["Any other business with the permission of the Chair"]).join("\n") }) }); }}>Make notice &amp; agenda</Button>}
        <Button className="btn" data-doc-word="" disabled={busy === "word"} onClick={word}>{busy === "word" ? "Making…" : "Word"}</Button>
        <Button className="btn primary" data-doc-pdf="" onClick={() => printPdf(model, letter, pages, name)}>Download PDF</Button>
      </div>
    </header>
    <div className="corp-doc">
      <aside className="corp-doc-form">
        <Card title="Meeting">
          <div className="corp-grid">{meetFields.map((f) => <Field key={f.k} f={f} P={P} v={v[f.k]} set={(x) => set({ [f.k]: x })} disabled={ro} />)}
            {v.venue === "other" && <Text label="Address of the venue" value={v.venueText} onSave={(x) => set({ venueText: x })} wide attr={["data-field", "venueText"]} disabled={ro} />}
            {tpl.kind === "minutes" && tpl.fields.map((f) => <Field key={f.k} f={f} P={P} v={v[f.k]} set={(x) => set({ [f.k]: x })} disabled={ro} />)}</div>
        </Card>
        {tpl.kind === "minutes" ? <MinutesForm co={co} P={P} doc={doc} set={set} disabled={ro} />
          : <Card title={tpl.title}><div className="corp-grid">{tpl.fields.map((f) => <Field key={f.k} f={f} P={P} v={v[f.k]} set={(x) => set({ [f.k]: x })} disabled={ro} />)}</div></Card>}
        <Checks tpl={tpl} P={P} model={model} v={v} />
        {may && <div className="corp-row">
          {final ? (owner ? <Button className="btn small" data-doc-draft="" onClick={() => saveDoc(co.id, { id: doc.id, status: "draft" })}>Back to draft</Button>
              : <span className="corp-note" data-doc-final-note="">Final: only the firm's owner takes it back to draft.</span>)
            : <Button className="btn small" data-doc-final="" disabled={!!model.finalBlock} title={model.finalBlock || undefined}
              onClick={() => saveDoc(co.id, { id: doc.id, status: "final", fields: Object.assign({}, v, { snapshot: snapshotOf(P0, co) }) })}>Mark as final</Button>}
          {!final && model.finalBlock && <span className="corp-note" data-doc-final-block="" style={{ color: "var(--corp-bad)" }}>{model.finalBlock}: it cannot be marked Final.</span>}
          {!final && <button className="linkbtn" data-doc-delete="" onClick={() => { dropDoc(co.id, doc.id); S.corpDoc = ""; render(); }}>Delete this draft</button>}
        </div>}
      </aside>
      <main className="corp-doc-view">
        <div className="corp-paper-bar">
          <div role="radiogroup" aria-label="Paper" className="corp-seg">
            <button role="radio" aria-checked={letter.on} data-paper="letterhead" disabled={ro} onClick={() => saveDoc(co.id, { id: doc.id, letterhead: true })}>With letterhead</button>
            <button role="radio" aria-checked={!letter.on} data-paper="plain" disabled={ro} onClick={() => saveDoc(co.id, { id: doc.id, letterhead: false })}>{tpl.kind === "minutes" ? "Minutes book page" : "Plain paper"}</button>
          </div>
          <span className="corp-note" data-page-count={pages.length}>{"A4 · " + pages.length + (pages.length === 1 ? " page" : " pages")}</span>
        </div>
        <Paper model={model} letter={letter} onPages={setPages} />
      </main>
    </div>
  </div>;
}

function Letterhead({ co, P }) {
  const [msg, setMsg] = useState("");
  const l = P.letterhead || {};
  const pick = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpe?g)$/.test(f.type)) { setMsg("A PNG or JPEG picture, please."); return; }
    if (f.size > 150 * 1024) { setMsg("The logo is " + Math.round(f.size / 1024) + " KB: keep it under 150 KB (a picture about 300 pixels wide is plenty)."); return; }
    // the file's own first bytes, not only its name or type, say it is a PNG or a JPEG
    f.slice(0, 8).arrayBuffer().then((buf) => {
      const kind = pictureKind(Array.from(new Uint8Array(buf)));
      if (!kind) { setMsg("That file is not a PNG or JPEG picture."); return; }
      const r = new FileReader();
      r.onload = () => { const u = String(r.result).replace(/^data:[^;,]*;base64,/, "data:image/" + kind + ";base64,"); if (!logoOk(u)) { setMsg("That picture could not be read."); return; } saveProfile(co.id, { letterhead: Object.assign({}, l, { logo: u }) }); setMsg("Logo kept."); };
      r.readAsDataURL(f);
    }, () => setMsg("That picture could not be read."));
  };
  return <section className="corp-card corp-card-body" style={{ paddingTop: 16 }} data-letterhead-card="">
    <h2 style={{ fontSize: 17 }}>Letterhead</h2>
    <p className="corp-note">From the company profile: name, CIN, registered office, phone and email. Every document can then be made on letterhead or plain paper.</p>
    <dl className="corp-dl" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div><dt>Name</dt><dd>{P.name || "—"}</dd></div><div><dt>CIN</dt><dd>{P.cin || "—"}</dd></div><div><dt>Address</dt><dd>{P.office || "—"}</dd></div>
    </dl>
    <div className="corp-grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <Text label="Phone" type="tel" value={P.phone} onSave={(v) => saveProfile(co.id, { phone: v })} attr={["data-lh", "phone"]} />
      <Text label="Email" type="email" value={l.email || P.email} onSave={(v) => saveProfile(co.id, { letterhead: Object.assign({}, l, { email: v }) })} attr={["data-lh", "email"]} />
      <Text label="Website" value={P.website} onSave={(v) => saveProfile(co.id, { website: v })} />
    </div>
    <div className="corp-row">{logoOk(l.logo) ? <img src={l.logo} alt="The company's logo" style={{ height: 40, maxWidth: 120, objectFit: "contain" }} data-logo-shown="" /> : <span className="corp-note">No logo: the letterhead shows the initials.</span>}
      <label className="btn small" style={{ cursor: "pointer" }}><input type="file" accept="image/png,image/jpeg" data-logo-input="" onChange={pick} style={{ display: "none" }} />{l.logo ? "Change logo" : "Upload logo"}</label>
      {l.logo && <button className="linkbtn" onClick={() => saveProfile(co.id, { letterhead: Object.assign({}, l, { logo: "" }) })}>Remove</button>}</div>
    {msg && <p className="corp-note" role="status">{msg}</p>}
  </section>;
}

function List({ co, P, c }) {
  const [q, setQ] = useState(""), [g, setG] = useState("All");
  const ds = directorsOf(P), kmp = ds.filter((d) => !isDirector(d)).length;
  const shown = GALLERY.filter((t) => (g === "All" || t.group === g) && (!q.trim() || (t.title + " " + t.law + " " + t.group).toLowerCase().includes(q.trim().toLowerCase())));
  const may = canEdit(co.id), watch = dueItems(P, c.filings).filter((x) => /AOC-4|MGT-7|ADT-1/.test(x.title)).slice(0, 3), nb = nextBoard(P);
  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><div className="corp-eyebrow">Secretarial · Documents</div><h1>Board resolutions, notices &amp; minutes</h1></div>
      <div className="corp-row">
        {may && <><Button className="btn" data-plan-meeting="" onClick={() => newDoc(co, P, byKey("board-notice"))}>Plan a board meeting</Button>
        <Button className="btn primary" data-new-minutes="" onClick={() => newDoc(co, P, MINUTES)}>New minutes</Button></>}
      </div>
    </header>
    <section className="corp-card" style={{ padding: "14px 20px" }}>
      <dl className="corp-kpis" style={{ borderTop: 0, paddingTop: 0, gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <div><dt>CIN</dt><dd style={{ fontSize: 14 }}>{P.cin || "—"}</dd></div><div><dt>Class</dt><dd style={{ fontSize: 14 }}>{CLASS[P.cls] || "—"}</dd></div>
        <div><dt>Directors</dt><dd style={{ fontSize: 14 }}>{ds.filter(isDirector).length + " · KMP: " + (kmp || "none")}</dd></div>
        <div><dt>Last board meeting</dt><dd style={{ fontSize: 14 }}>{dmy(P.lastBoard) || "—"}</dd></div></dl>
    </section>
    <div className="corp-cols">
      <div className="corp-main">
        <input type="text" aria-label="Search documents" data-doc-search="" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the templates: bank account, additional director, auditor, minutes…" />
        <div className="corp-row" role="group" aria-label="Kind of document">{GROUPS.map((x) => <button key={x} className={"corp-chip"} data-tone={g === x ? "navy" : undefined} aria-pressed={g === x}
          style={{ border: 0, cursor: "pointer", font: "inherit", fontSize: 12 }} onClick={() => setG(x)}>{x}</button>)}</div>
        <div className="corp-tiles" data-templates="">{shown.map((t) => <button key={t.key} className="corp-tile" data-template={t.key} disabled={!may} onClick={() => newDoc(co, P, t)}>
          <b>{t.title}</b><small>{(t.kind === "minutes" ? "Minutes" : t.kind === "notice" ? "Notice" : "Board resolution") + " · " + t.law + (t.form ? " · " + t.form : "")}</small></button>)}
          {!shown.length && <p className="corp-note">No template matches.</p>}</div>
        <p className="corp-help" style={{ margin: 0 }}>Every template's wording is to be checked by a Company Secretary before use.</p>
        <Card title="Documents of this company" pad={false} attr={["data-docs-list", ""]}>
          {c.docs.length ? <div className="corp-scroll"><table className="corp-table"><thead><tr><th>Document</th><th>Meeting</th><th>Status</th><th aria-label="Open" /></tr></thead>
            <tbody>{c.docs.map((d) => <tr key={d.id} data-doc-row={d.id}><td>{titleOf(d)}</td><td>{(d.fields || {}).meetingDate ? "Board · " + dmy(d.fields.meetingDate) : "—"}</td>
              <td><span className="corp-chip" data-tone={d.status === "final" ? "ok" : ""}>{d.status === "final" ? "Final" : "Draft"}</span></td>
              <td style={{ textAlign: "right" }}><button className="linkbtn" data-doc-open={d.id} onClick={() => { S.corpDoc = d.id; render(); }}>Open</button></td></tr>)}</tbody></table></div>
            : <div className="corp-empty">No documents yet. Pick a template above.</div>}
        </Card>
      </div>
      <aside className="corp-side">
        <section className="corp-card corp-card-body" style={{ paddingTop: 16 }}>
          <h2 style={{ fontSize: 17 }}>ROC filings to watch</h2>
          <div className="corp-list">{watch.map((x) => <div key={x.key} data-tone={x.tone}><span><b>{x.title}</b><br /><span className="corp-note">{x.sub}</span></span><span className="when">{x.when}</span></div>)}
            <div data-tone={nb ? "" : "warn"}><span><b>Next board meeting</b><br /><span className="corp-note">{nb ? nb.rule : "enter the last meeting's date in the profile"}</span></span><span className="when">{nb ? (nb.none ? "Not needed" : "by " + dmy(nb.by)) : "—"}</span></div></div>
        </section>
        {may && <Letterhead co={co} P={P} />}
      </aside>
    </div>
  </div>;
}

export default function Docs({ co }) {
  const c = corpOf(co.id), P = shown(co);
  // every director row has a stable id (documents name directors by it): given once, to the rows that have none
  const noId = (P._own.directors || []).some((d) => d && !d.id);
  useEffect(() => { if (noId && canEdit(co.id)) saveProfile(co.id, { directors: withIds(P._own.directors) }); }, [noId, c.cloud.state]);
  // a form's "Make the board resolution" (e-Forms) opens a new one from its template
  useEffect(() => { if (S.corpNew) { const t = byKey(S.corpNew); S.corpNew = ""; if (t) newDoc(co, P, t); } }, []);
  const doc = S.corpDoc && c.docs.find((d) => d.id === S.corpDoc);
  return <div data-corp-page="docs">{doc ? <Editor co={co} P={P} doc={doc} /> : <List co={co} P={P} c={c} />}</div>;
}
