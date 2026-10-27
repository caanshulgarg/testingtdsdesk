// "Have a coupon?" (the console's coupons, migration 120; owner, 27-Oct-2026: "coupons enterable at sign-up and in
// Settings"). Its own small file, loaded only where it is shown (main chunk at its budget):
//   default        Settings › Plan and credit: the firm's owner types a code; coupon_redeem checks every rule and
//                  answers in plain words (a refusal is an answer, not an error); applied, the account is read again
//   SignupCoupon   the register form's details step: the code is kept with the form (S.cloudForm.coupon) and, once the
//                  account is made, on this computer until the firm exists (Cloud.signupCoupon, src/js/27, redeems it
//                  with source 'signup' at the first sign-in)
import { useState } from "react";

export function SignupCoupon() {
  const f = S.cloudForm || {};
  return <div className="signin-field" data-signup-coupon="">
    <div className="signin-label-row"><label htmlFor="si-coupon">Coupon code</label></div>
    <input id="si-coupon" type="text" data-cloud="coupon" autoComplete="off" spellCheck={false} maxLength={24} autoFocus
      defaultValue={f.coupon || ""} style={{ textTransform: "uppercase" }} onChange={(ev) => cloudForm("coupon", ev.target.value)} aria-describedby="si-coupon-hint" />
    <span className="signin-hint" id="si-coupon-hint">Applied when your firm is ready, after you confirm your email.</span></div>;
}

export default function CouponBox() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  if (!Cloud.on() || Cloud.st.role !== "owner") return null;
  const apply = async (ev) => {
    ev.preventDefault();
    const c = code.replace(/\s/g, "").toUpperCase();
    if (!c) { setRes({ ok: false, error: "Enter the code." }); return; }
    setBusy(true); setRes(null);
    let r;
    try { r = await Cloud.rpc("coupon_redeem", { p_code: c, p_source: "settings" }); }
    catch (e) { r = { ok: false, error: "The code could not be checked just now. Try again in a minute." }; }
    setBusy(false); setRes(r || { ok: false, error: "That code cannot be used." });
    if (r && r.ok) { setCode(""); if (typeof loadAccount === "function") loadAccount(true); }
  };
  return <div className="pane" data-coupon-box="">
    <h2>Have a coupon?</h2>
    <form className="row" onSubmit={apply} noValidate style={{ alignItems: "center" }}>
      <input type="text" aria-label="Coupon code" placeholder="Coupon code" value={code} maxLength={24} spellCheck={false} autoComplete="off"
        style={{ textTransform: "uppercase", maxWidth: 220 }} onChange={(ev) => { setCode(ev.target.value); setRes(null); }} data-coupon-code="" />
      <button type="submit" className="btn small primary" disabled={busy} data-coupon-apply="">{busy ? "Checking…" : "Apply"}</button>
    </form>
    {res && <p className="note" role={res.ok ? "status" : "alert"} data-coupon-result={res.ok ? "ok" : "no"} style={{ margin: "8px 0 0", color: res.ok ? "var(--ok, inherit)" : "var(--stop, inherit)" }}>
      {res.ok ? res.message : res.error}</p>}
  </div>;
}
