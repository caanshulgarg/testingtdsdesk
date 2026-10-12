// FinCom opening after a sign-in (stability batch 1; the owner: "a loader like Claude/Samsung"): the FinCom mark, shown
// only when the wait is longer than 300 ms and for at most a second, then the page's shape until the firm's first sync is
// done (or 15 s). The same mark and timing as the frame index.html draws before the program loads. Still (no pulse) when
// the computer asks for reduced motion.
export function openingAfterSignIn() {
  const at = S.signInOpening;
  if (!at || typeof signInNeeded !== "function" || signInNeeded()) return false;
  const st = Cloud.st || {};
  if ((st.lastSync && st.lastSync >= at) || st.error || st.state === "signedout" || Date.now() - at > 15000) { S.signInOpening = 0; return false; }
  return true;
}
export default function OpenLoader() {
  const row = <div className="boot-row"><i className="boot-bar"></i><i className="boot-bar"></i><i className="boot-bar"></i></div>;
  return <div className="open-wait" data-open-wait="">
    <div className="open-loader" role="status" aria-label="Opening FinCom"><span className="boot-mark" aria-hidden="true">F</span><small aria-hidden="true">Opening FinCom</small></div>
    <div className="pg-skel open-late" aria-hidden="true">
      <div className="boot-cards"><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div></div>
      <div className="boot-rows">{row}{row}{row}{row}</div>
    </div>
  </div>;
}
