// "Show advances in GST returns (Tables 11A/11B)": one setting per client, off unless turned on, existing clients too (the
// owner, 22-Oct-2026: "don't treat advance unless we say.. there should be an option whether to show advance in gst
// return"). Kept as the client's confirmed choice co.choices.advGst = {value: "on" | "off", state: "confirmed", by, at,
// prev} (choiceConfirm, src/js/60-choices.js), so it goes with the client to the cloud and to every computer, with who
// changed it and when. GSTAdv.ready() (src/js/14) reads it: off, there is nothing in 11A/11B of GSTR-1, 3B 3.1(a), the
// JSON and Excel, and no check about advances. Only the owner and staff change it; a "look only" user sees it disabled.
// Shown on the GST page's Advances (gst/Workings.jsx) and in Client setup → GST (gst/GstSettings.jsx).

export const advOn = (co) => choiceValue(co, "advGst") === "on";
// the owner and staff (a computer not signed in to the firm's account: its own user)
export const advMay = () => !(S.account && S.account.me) || ["owner", "staff"].includes(S.account.me.role);
const NO_RIGHT = "Only the firm’s owner and staff can change this";

function advSet(co, on) {
  if (!co || !advMay()) return;
  choiceConfirm(co, "advGst", on ? "on" : "off");
  GSTR._carry = null;                                // 3B's cash and credit carried forward depend on 3.1(a)
  toast(on ? "Advances are shown in GST returns for " + (co.name || "this client") + "." : "Advances are no longer shown in GST returns for " + (co.name || "this client") + ".");
  render();
}

// who set it and when (none: never set, so off as for every client)
function Who({ co }) {
  const c = choiceGet(co, "advGst");
  if (!c || c.state !== "confirmed") return <span className="note" data-adv-who="">Off for every client unless turned on.</span>;
  return <span className="note" data-adv-who="">{"Turned " + (c.value === "on" ? "on" : "off") + (c.by ? " by " + c.by : "") + (c.at ? " · " + fmtDateTime(c.at) : "")}</span>;
}

// the setting: a tick with who and when
export function AdvOptIn({ co }) {
  co = co || CO();
  if (!co) return null;
  const on = advOn(co), may = advMay();
  return <div className="row" data-adv-optin={on ? "on" : "off"} style={{ gap: 8, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
    <label title={may ? undefined : NO_RIGHT}><input type="checkbox" checked={on} disabled={!may} aria-label="Show advances in GST returns (Tables 11A/11B)" onChange={(ev) => advSet(co, ev.target.checked)} />{" "}Show advances in GST returns (Tables 11A/11B)</label>
    <Who co={co} />
    {!may && <span className="note" data-adv-readonly="">{NO_RIGHT}.</span>}
  </div>;
}

// the Advances page while off: one quiet line
export function AdvOffLine({ co }) {
  co = co || CO();
  const may = advMay();
  return <p className="note" data-adv-off="" style={{ margin: "8px 0" }}>Advances are not shown in GST returns for this client{" · "}
    <button type="button" className="linkbtn" data-adv-turn-on="" disabled={!may} title={may ? undefined : NO_RIGHT} onClick={() => advSet(co, true)}>Turn on</button>
    {!may && <span data-adv-readonly="">{" (" + NO_RIGHT.toLowerCase() + ")"}</span>}</p>;
}
