import { useEffect, useState } from "react";
import { LogOut, Menu, Moon, Sun } from "lucide-react";
import { aal, clearEnded, ended, enroll, myFactors, onSession, session, signIn, signOut, verify, watchIdle } from "./lib/auth.js";
import { call } from "./lib/api.js";
import { href, useRoute } from "./lib/route.js";
import { MODULES } from "./modules/registry.js";
import { Chip } from "./ui/bits.jsx";

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
  if (!sess || aal() !== "aal2") return <SignIn sess={sess} />;
  if (!me) return <div className="center"><p className="muted" role="status">{err || "Opening the console…"}</p></div>;
  return <Shell me={me} />;
}

function SignIn({ sess }) {
  const [step, setStep] = useState(sess ? "factor" : "password");
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
    setFactor({ id: e.id, qr: e.totp?.qr_code, secret: e.totp?.secret }); setStep("enroll");
  };
  useEffect(() => { if (sess && step === "factor") run(toFactor); }, []);
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
