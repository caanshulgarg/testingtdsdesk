// Error reports to Sentry from the staging (test) build only (docs/sentry.md; the owner's conditions of 08-Oct-2026).
// Loaded by main.jsx only in a test build (npm run build:test) built without FINCOM_SENTRY=off; a live build (npm run
// build) never has this file. It then starts only on staging.fincom.live (the React preview and the review build), never
// on another host, and never when this browser has said no (localStorage "fincom.sentry" = "off").
// What goes: the error's type and scrubbed message, its stack, the page's NAME, the release, "staging", the browser, a
// random id of this browser. Every event and breadcrumb goes through the one scrubber (server/_shared/sentry-scrub.js).
// No replay, no screenshots, no feedback widget, no request bodies, no XHR / fetch / click breadcrumbs, no user.
import {
  init, captureException, addBreadcrumb, setTag, setUser,
  breadcrumbsIntegration, globalHandlersIntegration, linkedErrorsIntegration, dedupeIntegration, browserApiErrorsIntegration, functionToStringIntegration,
} from "@sentry/browser";
import { scrubEvent, scrubBreadcrumb, scrubRoute, SENTRY_ENVIRONMENT } from "../../server/_shared/sentry-scrub.js";
import { subscribe } from "./store.js";

export const DSN = "https://7f2432ad2a6406244d931f4856c30933@o4512221111320576.ingest.us.sentry.io/4512221234724864";
export const STAGING_HOSTS = ["staging.fincom.live"];

// whether this page may report: never when the browser said no; on the staging host only (a test may force it on a
// local server: window.__fincomSentryForce, set before the page loads)
export function wanted(loc = window.location, w = window) {
  try { if (w.localStorage.getItem("fincom.sentry") === "off") return false; } catch { /* storage blocked: decide by host */ }
  if (w.__fincomSentryForce === true) return true;
  return STAGING_HOSTS.includes(loc.hostname);
}

// a random id of this browser (no person, firm or client in it), kept so Sentry can count the computers an error is on
function installId() {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    let id = localStorage.getItem("fincom.sentry.install");
    if (!/^[0-9a-f]{32}$/.test(id || "")) { id = make(); localStorage.setItem("fincom.sentry.install", id); }
    return id;
  } catch { return make(); }
}

// the page's NAME: home/<page> or client/<tab>; never the client, the bill or any id
export function routeName() {
  // S is the business logic's state (a global const of legacy.js, not a property of window)
  const st = typeof S !== "undefined" ? S : null;   // eslint-disable-line no-undef
  if (!st) return "loading";
  return scrubRoute(st.view === "company" ? "client/" + (st.tab || "work") : "home/" + (st.homeTab || "clients"));
}

let started = false;
export function start() {
  if (started || !wanted()) return false;
  started = true;
  init({
    dsn: DSN,
    environment: SENTRY_ENVIRONMENT,
    release: __SENTRY_RELEASE__,
    sendDefaultPii: false,
    sendClientReports: false,
    defaultIntegrations: false,
    integrations: [
      functionToStringIntegration(), browserApiErrorsIntegration(), globalHandlersIntegration(), linkedErrorsIntegration(), dedupeIntegration(),
      // console errors only (the scrubber drops the rest): no clicks or typing, no XHR / fetch addresses, no history
      breadcrumbsIntegration({ console: true, dom: false, fetch: false, history: false, sentry: false, xhr: false }),
    ],
    maxBreadcrumbs: 30,
    attachStacktrace: false,
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
    beforeSend: (e) => {
      // the page's address (scrubbed to scheme, host and path) and the browser, for "which browser"; nothing else of the request
      e.request = { url: window.location.href, headers: { "User-Agent": navigator.userAgent } };
      return scrubEvent(e);
    },
  });
  setUser({ id: installId() });
  let last = null;
  const onDraw = () => {
    const r = routeName();
    if (r === last) return;
    if (last) addBreadcrumb({ category: "navigation", data: { from: last, to: r } });
    last = r; setTag("route", r);
  };
  onDraw(); subscribe(onDraw);
  // a part of the page that failed to draw (Guard.jsx): reported with the part's name
  window.__fincomReport = (error, guard) => { try { captureException(error, { tags: { guard: String(guard || "") } }); } catch { /* never in the way */ } };
  return true;
}
