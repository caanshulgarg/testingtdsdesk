// Where an entry in a TDS or GST list came from (round 44, the owner's decision of 11-Oct-2026): the entries the bridge
// sent by itself (FinCom's cloud copy) or the Day Book the CA uploaded; one entry is counted once, the later version
// (Tally's AlterID) kept (BookSrc, src/js/67-book-sources.js).
export const srcWords = (r) => (r && r.src === "bridge" ? "Bridge" : "Day Book");
export default function SrcTag({ r }) {
  return <small className="note" data-src={r && r.src === "bridge" ? "bridge" : "daybook"} title={r && r.src === "bridge" ? "Sent by FinCom Bridge from Tally" : "From the Day Book uploaded"}>{srcWords(r)}</small>;
}
