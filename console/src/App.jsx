import { useEffect, useState } from "react";
import { LogOut, Menu, Moon, Sun } from "lucide-react";
import { aal, clearEnded, dropLink, ended, enroll, forgotPassword, myFactors, onSession, passwordProblem, pendingLink, session, setPassword as savePassword, signIn, signOut, verify, watchIdle } from "./lib/auth.js";
import { call } from "./lib/api.js";
import { href, useRoute } from "./lib/route.js";
import { MODULES } from "./modules/registry.js";
import { Chip } from "./ui/bits.jsx";

// the QR code as a safe image source (as the user app's mfaQrSrc, src/js/43-two-step.js). GoTrue sends qr_code as a raw,
// un-encoded SVG data URI ("data:image/svg+xml;utf-8,<svg ... fill=\"#000000\">"): the '#' starts a URL fragment, so the
// image is blank (28-Oct-2026, the owner's first console sign-in). Raw markup is re-encoded as base64; base64, PNG and
// percent-encoded sources are kept or decoded; anything else gives "" (never injected as HTML).
function qrSrc(qr) {
  qr = String(qr || "").trim();
  if (!qr) return "";
  const b64 = (svg) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  if (/^<(\?xml|svg)/i.test(qr)) return b64(qr);
  if (/^data:image\/png;base64,/i.test(qr)) return qr;
  if (/^data:image\/svg\+xml/i.test(qr)) {
    const at = qr.indexOf(","); if (at < 0) return "";
    const head = qr.slice(0, at), body = qr.slice(at + 1);
    if (/;base64$/i.test(head)) return qr;
    if (/^\s*</.test(body)) return b64(body);
    try { return b64(decodeURIComponent(body)); } catch { return qr; }
  }
  return "";
}

export function App() {
  const [sess, setSess] = useState(session());
  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => onSession(setSess), []);
  useEffect(() => {
    setMe(null);
    if (!sess || aal() !== "aal2") return;
    call("me").then(setMe, (e) => { setErr(e.message); signOut(e.reason === "not_admin" ? "This login is not a console admin." : e.message); });
  }, [sess?.access_token ? sess.user?.id + aal() : ""]);
  useEffect(() => (sess && aal() === "aal2" ? watchIdle() : undefined), [!!sess && aal() === "aal2"]);
  if (!sess || aal() !== "aal2" || pendingLink()) return <SignIn sess={sess} />;
  if (!me) return <div className="center"><p className="muted" role="status">{err || "Opening the console…"}</p></div>;
  return <Shell me={me} />;
}

function SignIn({ sess }) {
  const link = pendingLink();                     // arrived from an invite or reset email: the password first
  const [step, setStep] = useState(link ? "setpw" : sess ? "factor" : "password");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState(null);     // {id, qr?, secret?}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(ended());
  const run = async (f) => { setBusy(true); setMsg(""); clearEnded(); try { await f(); } catch (e) { setMsg(e.message); } setBusy(false); };
  const toFactor = async () => {
    const fs = await myFactors();
    const v = fs.find((f) => f.status === "verified");
    if (v) { setFactor({ id: v.id }); setStep("code"); return; }
    const e = await enroll();
    setFactor({ id: e.id, qr: qrSrc(e.totp?.qr_code), secret: e.totp?.secret }); setStep("enroll");
  };
  useEffect(() => { if (sess && step === "factor") run(toFactor); }, []);
  const to = (s) => { setMsg(""); clearEnded(); setStep(s); };
  return (
    <main className="signin">
      <div className="signin-card">
        <h1>FinCom Console</h1>
        <p className="muted">For FinCom staff only. Every action is recorded.</p>
        {msg && <div className="note note-bad" role="alert">{msg}</div>}
        {step === "password" && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await signIn(email, password); await toFactor(); }); }}>
            <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button className="btn primary wide" disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
            <button type="button" className="link" onClick={() => to("forgot")}>Forgot password?</button>
          </form>
        )}
        {step === "forgot" && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await forgotPassword(email); setStep("sent"); }); }}>
            <h2>Forgot password</h2>
            <p>Type the email of your FinCom login. We send it a link to set a new password.</p>
            <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
            <button className="btn primary wide" disabled={busy}>{busy ? "Sending…" : "Send the link"}</button>
            <button type="button" className="link" onClick={() => to("password")}>Back to sign-in</button>
          </form>
        )}
        {step === "sent" && (
          <div className="stack">
            <div className="note" role="status" data-testid="sent">If <b>{email.trim()}</b> has a FinCom login, an email with a link to set a new password is on its way. The link works once. Check the spam folder if it does not come in a few minutes.</div>
            <button type="button" className="link" onClick={() => to("password")}>Back to sign-in</button>
          </div>
        )}
        {step === "setpw" && (
          <form noValidate onSubmit={(e) => {
            e.preventDefault();
            const bad = passwordProblem(pw1, pw2);
            if (bad) { setMsg(bad); return; }
            run(async () => { await savePassword(pw1); setPw1(""); setPw2(""); await toFactor(); });
          }}>
            <h2>{link?.type === "recovery" ? "Set a new password" : "Set your password"}</h2>
            {link?.type === "recovery"
              ? <p>For <b>{link?.email}</b>. After this you enter the code from your authenticator app.</p>
              : <p>Welcome. You have been added to the FinCom Console. Choose the password for <b>{link?.email}</b>. Next you set up two-step sign-in with an authenticator app on your phone.</p>}
            <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} data-testid="pw1" autoFocus /></label>
            <label className="field"><span>Type it again</span><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="pw2" /></label>
            <p className="small muted">10 characters or more, with letters and digits.</p>
            <button className="btn primary wide" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
            <button type="button" className="link" onClick={() => { dropLink(); to("password"); }}>Back to sign-in</button>
          </form>
        )}
        {(step === "code" || step === "enroll") && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await verify(factor.id, code); }); }}>
            {step === "enroll" ? (
              <div className="enrol">
                <p>Two-step sign-in is required for the console. Scan this with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code.</p>
                {factor?.qr && <img className="qr" src={factor.qr} alt="QR code for your authenticator app" width={180} height={180} />}
                {factor?.secret && <p className="small muted">Or type this key: <code data-testid="totp-secret">{factor.secret}</code></p>}
              </div>
            ) : <p>Enter the 6-digit code from your authenticator app.</p>}
            <label className="field"><span>Code</span><input className="input code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></label>
            <button className="btn primary wide" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
            <button type="button" className="link" onClick={() => { signOut(); setStep("password"); }}>Use another account</button>
          </form>
        )}
        {step === "factor" && <p className="muted" role="status">Checking your two-step sign-in…</p>}
        <p className="small muted note-soft">Passkeys and hardware security keys come later (phase 6). Sessions end after 30 minutes without activity.</p>
      </div>
    </main>
  );
}

function Shell({ me }) {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route.path]);
  const mine = MODULES.filter((m) => me.actions.includes(m.action));
  let page = null;
  for (const m of MODULES) for (const r of m.routes) {
    const hit = !page && route.path.match(r.path);
    if (hit) page = mine.includes(m) ? r.render(hit, me) : <section className="page"><h1>Not for your role</h1><p className="muted">Your role ({me.role}) cannot open this page.</p></section>;
  }
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("fincom-console:theme", t); } catch { /* */ }
    document.documentElement.dataset.theme = t; setTheme(t);
  };
  return (
    <div className="shell">
      <header className="top">
        <button className="icon-b phone-only" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}><Menu size={18} /></button>
        <a className="brand" href={href("dashboard")}>FinCom <span>Console</span></a>
        <span className="env">staging</span>
        <div className="top-right">
          <span className="who" data-testid="who">{me.email}</span>
          <Chip testid="role">{me.role}</Chip>
          <button className="icon-b" aria-label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={flip} data-testid="theme">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="btn ghost" onClick={() => signOut("You signed out.")} data-testid="signout"><LogOut size={16} /> <span className="no-phone">Sign out</span></button>
        </div>
      </header>
      <nav className={"side" + (navOpen ? " open" : "")} aria-label="Console">
        {mine.map((m) => {
          const Icon = m.icon;
          const on = route.path === m.id || route.path.startsWith(m.id + "/");
          return <a key={m.id} href={href(m.id)} className={on ? "on" : ""} aria-current={on ? "page" : undefined} data-nav={m.id}>{Icon && <Icon size={16} />}{m.label}</a>;
        })}
      </nav>
      <main className="main">{page || <section className="page"><h1>Not found</h1><p><a href={href("dashboard")}>Go to the dashboard</a></p></section>}</main>
    </div>
  );
}
