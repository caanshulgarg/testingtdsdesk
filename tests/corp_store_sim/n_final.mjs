// the re-review of e49c57846: a document marked Final on another computer takes no unsaved edit from here (dropped, said),
// and the server's lock never makes a loop of retries
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
srv.corp_documents.push({ id: "11111111-2222-4333-8444-555555555555", client_id: "c1", template: "bank-open", title: "Opening of bank account", kind: "resolution", status: "draft", fields: { bank: "B" }, meeting_on: null, letterhead: true, updated_at: st() });
H.hook = async (m, t, f, o) => { const r = srv.corp_documents[0]; if (m === "PATCH" && t === "corp_documents" && r && r.status === "final") throw new Error("corp_documents: a final document is locked; only its status goes back to draft (42501)"); };
const S = await import(STORE);
S.corpOf("c1"); await W(30);
const id = srv.corp_documents[0].id;
console.log("on a read");
H.fail = true; S.saveDoc("c1", { id, fields: { bank: "Typed here" } }); await W(500); H.fail = false;
Object.assign(srv.corp_documents[0], { status: "final", updated_at: st() });
H.log = []; await S.pull("c1"); await W(600);
ok(S.corpOf("c1").docs[0].status === "final" && S.corpOf("c1").docs[0].fields.bank === "B" && !Object.keys(S.corpOf("c1").pending).length && /Marked Final on another computer: your unsaved change was not applied/.test(S.cloudNote("c1").text), "the edit dropped, said (" + S.cloudNote("c1").text + ")");
ok(!H.log.some((l) => l.m === "PATCH"), "nothing sent");
console.log("on the save (the server's lock)");
Object.assign(srv.corp_documents[0], { status: "draft", updated_at: st() }); await S.pull("c1"); await W(100);
S.saveDoc("c1", { id, fields: { bank: "Typed again" } });
Object.assign(srv.corp_documents[0], { status: "final", updated_at: st() });
const at = srv.corp_documents[0].updated_at;
// this computer still holds the draft's updated_at: make its conditional PATCH meet the row (as if read just now)
const e = window.FCCorp.raw("c1").docs[id]; e.at = at;
H.log = []; await W(6500);
ok(H.log.filter((l) => l.m === "PATCH").length === 1 && srv.corp_documents[0].fields.bank === "B" && !Object.keys(S.corpOf("c1").pending).length && /Marked Final on another computer/.test(S.cloudNote("c1").text), "one PATCH refused by the lock, no retry; dropped and said (" + H.log.map((l) => l.m) + ")");
console.log("the lock, and the read again failing");
Object.assign(srv.corp_documents[0], { status: "draft", updated_at: st() }); await S.pull("c1"); await W(100);
S.saveDoc("c1", { id, fields: { bank: "Typed a third time" } });
Object.assign(srv.corp_documents[0], { status: "final", updated_at: st() }); window.FCCorp.raw("c1").docs[id].at = srv.corp_documents[0].updated_at;
const h0 = H.hook; H.hook = async (m, t, f, o) => { await h0(m, t, f, o); if (m === "GET" && t === "corp_documents" && f.id) throw new TypeError("Failed to fetch"); };
H.log = []; await W(6500);
const nt = S.cloudNote("c1");
ok(S.corpOf("c1").pending["d:" + id] && nt.retry && /^Not saved: /.test(nt.text) && H.log.filter((l) => l.m === "PATCH").length === 1, "the edit kept, not saved, with Retry; no loop (" + nt.text + "; " + H.log.map((l) => l.m) + ")");
done();
