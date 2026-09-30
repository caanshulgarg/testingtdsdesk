// Collect: everything that arrives for this client, before review: its inbox, the upload box (bills or a bank
// statement), and the files being read. Was viewCollect() in src/js/02.
import DocqPanel from "../parts/Docq.jsx";
import UploadBlock from "../parts/UploadBlock.jsx";
import { Jobs } from "../parts/Reading.jsx";

export default function Collect() {
  const co = CO(), bank = docType() === "bank";
  const inbox = Cloud.on() && docqFor(S.coId).length > 0;
  const jobs = S.jobs.some((j) => j.target === S.coId || j.cid === S.coId || j.target === "auto");
  return (
    <div className="collect">
      {inbox ? <DocqPanel cid={S.coId} /> : <p className="note" style={{ margin: "0 0 12px" }}>Nothing waiting in the inbox for {co.name}.</p>}
      {bank ? (
        <section className="collect-card">
          <h3>Upload a bank statement</h3>
          {/* the file chosen, or dropped here (id bankDrop), is taken by the bank's own handlers until the bank screens move */}
          <div className="drop" id="bankDrop" tabIndex={0} role="button" aria-label="Upload a bank statement"
            onClick={() => document.getElementById("bankIn").click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("bankIn").click(); } }}>
            <strong>Drop a statement here, or click to choose</strong>
            <div className="note">Excel, CSV or PDF from any bank. The balances are checked, and the statement is filed under the right account.</div>
          </div>
          <input type="file" id="bankIn" accept=".xls,.xlsx,.csv,.pdf,.txt" multiple className="hidden" onChange={(e) => bankChange(e.target)} />
        </section>
      ) : <section className="collect-card"><h3>Upload purchase bills</h3><UploadBlock /></section>}
      {jobs && <section className="collect-card"><Jobs which={S.coId} /><button className="btn small" onClick={() => goStep("review")}>Review them</button></section>}
    </div>
  );
}
