// The link to FinCom's status page (reliability item 5): staging.fincom.live/status/, written by the uptime watch. On the
// test build only (the build published to staging, which the watch checks); a live build shows no link.
export const STATUS_URL = "https://staging.fincom.live/status/";
export const statusLinkOn = () => import.meta.env.MODE === "test";
export const statusLinkHtml = () => (statusLinkOn() ? '<a href="' + STATUS_URL + '" target="_blank" rel="noopener noreferrer" data-status-link="">Status</a>' : "");
export default function StatusLink() {
  return statusLinkOn() ? <a href={STATUS_URL} target="_blank" rel="noopener noreferrer" data-status-link="">Status</a> : null;
}
