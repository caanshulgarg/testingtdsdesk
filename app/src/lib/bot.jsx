// The bot check on the sign-in and register forms (26-Oct-2026, the owner: "Security of sign in and sign up page should be
// better"): Cloudflare Turnstile, in its "interaction-only" look, so nothing shows unless Cloudflare wants the person to
// tick a box. Its token goes with the form (Cloud.signInCall in src/js/27 through window.fincomBot; lib/authLink.jsx's
// signUp) to the signin and signup functions, which pass it to Supabase Auth; Auth checks it once its bot protection is
// switched on (Authentication → Bot protection, with the widget's secret key).
// Only in a build with a site key (vite.config.js: FINCOM_TURNSTILE_SITE_KEY or app/turnstile.json); without one this file
// is not in the build at all, the page is as before, and Cloudflare's address is not in the page's CSP.
// Its own file, loaded with the sign-in page's form; Cloudflare's script is fetched only then.
import { useEffect, useRef } from "react";

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading = null, token = "", widget = null, waiting = [];
function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return loading || (loading = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true;
    s.onload = () => (window.turnstile ? ok(window.turnstile) : no(new Error("no turnstile")));
    s.onerror = () => { loading = null; s.remove(); no(new Error("The check that you are not a robot could not load.")); };
    document.head.appendChild(s);
  }));
}
const got = (t) => { token = t || ""; if (token) { waiting.forEach((f) => f(token)); waiting = []; } };

// the token for one sign-in or sign-up (each token is good once): waits up to 15 s for Cloudflare's answer, then the
// widget is reset for the next try. "" when there is none (the server or Auth then says so)
window.fincomBot = () => new Promise((done) => {
  const give = (t) => { token = ""; try { if (window.turnstile && widget !== null) window.turnstile.reset(widget); } catch (e) { /* a new one comes */ } done(t); };
  if (token) return give(token);
  if (widget === null) return done("");
  const timer = setTimeout(() => { waiting = waiting.filter((f) => f !== on); done(""); }, 15000);
  const on = (t) => { clearTimeout(timer); give(t); };
  waiting.push(on);
});

export default function BotCheck({ action }) {
  const ref = useRef(null);
  useEffect(() => {
    let gone = false, id = null;
    load().then((ts) => {
      if (gone || !ref.current) return;
      id = widget = ts.render(ref.current, { sitekey: __TURNSTILE_KEY__, action, appearance: "interaction-only",
        callback: got, "expired-callback": () => got(""), "error-callback": () => got("") });
    }, () => { /* Cloudflare not reached: the form goes without a token; Auth says so once its check is on */ });
    return () => { gone = true; token = ""; if (id !== null) { try { window.turnstile.remove(id); } catch (e) { /* gone */ } if (widget === id) widget = null; } };
  }, [action]);
  return <div ref={ref} data-bot-check={action} />;
}
