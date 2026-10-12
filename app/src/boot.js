// The frame index.html draws before the program loads (stability batch 1): the sidebar, the top bar's places and the
// page's shape, marked data-boot-part. It stays until the firm's settings are loaded, then the real parts take its place
// in the same drawing (nothing in between is shown, and nothing moves). Whether its page shape was already showing is
// noted, so a client still opening keeps showing the shape at once (PageSkeleton) rather than blanking it first
let shapeShown = false;
export const bootShapeShown = () => shapeShown;
let booted = false;
export function clearBoot() {
  if (booted) return;
  booted = true;
  const sk = document.querySelector("#app .boot-skel"), ld = document.querySelector("#app .boot-loader");
  try { shapeShown = !!((sk && +getComputedStyle(sk).opacity > 0.5) || (ld && +getComputedStyle(ld).opacity > 0.05)); } catch (e) { shapeShown = false; }
  document.querySelectorAll("[data-boot-part]").forEach((el) => el.remove());
}
export function bootDone() {
  const d = document.documentElement;
  if (!d.hasAttribute("data-boot")) return;
  d.removeAttribute("data-boot"); d.removeAttribute("data-boot-co"); d.removeAttribute("data-boot-quick"); d.removeAttribute("data-boot-shown");
  // this build has opened here: its files are in the cache, so the next open shows no FinCom loader
  try { if (typeof __BUILD_ID__ !== "undefined") localStorage.setItem("fincom:opened", __BUILD_ID__); } catch (e) { /* storage blocked: the loader rules still hold */ }
}

