// Error reports to Sentry from the staging (test) build only (docs/sentry.md; the owner's conditions of 08-Oct-2026).
// Loaded by main.jsx only in a test build (npm run build:test) built without FINCOM_SENTRY=off; a live build (npm run
// build) never has this file. It then starts only on staging.fincom.live (the React preview and the review build), never
// on another host, and never when this browser has said no (localStorage "fincom.sentry" = "off").
// What goes: the error's type and scrubbed message, its stack, the page's NAME, the release, "staging", the browser, a
// random id of this browser. Every event and breadcrumb goes through the one scrubber (server/_shared/sentry-scrub.js).
// No replay, no screenshots, no feedback widget, no request bodies, no XHR / fetch / click breadcrumbs, no user.
// The speed of real use (reliability item 2, 12-Oct-2026): on PERF_SAMPLE_RATE of page opens, the page load's Web Vitals
// (LCP, FCP, CLS, TTFB) as one transaction and the slowest interaction's INP as one span, each with the release and
// rebuilt by the same scrubber (scrubTransaction, scrubSpan): numbers, ids made by Sentry, the page's NAME; no request is
// traced and none carries a trace header; no span's words, element, label or address. Read it in Sentry: Insights ->
// Frontend -> Web Vitals (project fincom-app-staging), or Explore -> Traces with transaction "fincom-app".
import {
  init, captureException, addBreadcrumb, setTag, setUser, browserTracingIntegration,
  breadcrumbsIntegration, globalHandlersIntegration, linkedErrorsIntegration, dedupeIntegration, browserApiErrorsIntegration, functionToStringIntegration,
} from "@sentry/browser";
import { scrubEvent, scrubBreadcrumb, scrubRoute, scrubTransaction, scrubSpan, SPEED_NAME, SENTRY_ENVIRONMENT } from "../../server/_shared/sentry-scrub.js";
import { subscribe } from "./store.js";

export const DSN = "https://7f2432ad2a6406244d931f4856c30933@o4512221111320576.ingest.us.sentry.io/4512221234724864";
export const STAGING_HOSTS = ["staging.fincom.live"];
// the share of page opens whose speed is sent (a test may set window.__fincomPerfRate, 0 to 1, before the page loads)
export const PERF_SAMPLE_RATE = 0.15;
function perfRate(w = window) { const r = w.__fincomPerfRate; return typeof r === "number" && r >= 0 && r <= 1 ? r : PERF_SAMPLE_RATE; }

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
      // the page load and INP only: no request, navigation, long task or animation-frame span; one name for every page
      browserTracingIntegration({ traceFetch: false, traceXHR: false, enableHTTPTimings: false, instrumentNavigation: false, enableLongTask: false,
        enableLongAnimationFrame: false, markBackgroundSpan: false, enableInp: true, linkPreviousTrace: "off",
        beforeStartSpan: (o) => ({ ...o, name: SPEED_NAME, attributes: {} }) }),
    ],
    tracesSampleRate: perfRate(),
    // no request of the page gets Sentry's trace headers (the cloud never sees them)
    tracePropagationTargets: [],
    beforeSendTransaction: (t) => scrubTransaction(t),
    beforeSendSpan: (s) => scrubSpan(s),
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
  // errors from before Sentry was loaded (main.jsx loads it once the page is up): reported now
  try { (window.__fincomEarly || []).splice(0).forEach((e) => { if (e instanceof Error) captureException(e); }); } catch { /* never in the way */ }
  // a part of the page that failed to draw (Guard.jsx): reported with the part's name
  window.__fincomReport = (error, guard) => { try { captureException(error, { tags: { guard: String(guard || "") } }); } catch { /* never in the way */ } };
  return true;
}
