// No microphone or camera reached this browser (23-Oct-2026; the owner tried calls and Ask FinCom's voice from Remote
// Desktop to the office server: no camera or microphone, and the voice text wrong or empty). One plain message for the
// call's lobby and Ask FinCom's mic, with the steps to turn on Remote Desktop's redirection.
export const NO_DEVICE_TEXT = "No microphone/camera reached this browser. If you're working inside Remote Desktop or a cloud PC, open FinCom in Chrome on your own laptop or phone instead (it's the same account) — or turn on microphone/camera redirection in Remote Desktop.";
export const NO_DEVICE_STEPS = [
  "On your own computer: allow the microphone and camera for FinCom (the lock or camera sign beside the address), and close any other app using them.",
  "Remote Desktop: Show Options → Local Resources → Remote audio → Settings → Record from this computer.",
  "Remote Desktop: Local Resources → Local devices and resources → More… → Video capture devices (tick your camera).",
  "Connect again. If the server still blocks the microphone or camera, ask IT to allow audio and video redirection.",
];
export const NO_SOUND_TEXT = "Your microphone sent no sound, so nothing was sent to be heard.";
// the browser's refusals that mean "no device here" (missing, blocked, held by Remote Desktop or another app)
const NAMES = /^(NotSupportedError|NotFoundError|DevicesNotFoundError|NotAllowedError|SecurityError|PermissionDeniedError|NotReadableError|TrackStartError|OverconstrainedError)$/;
export const noDeviceError = (e) => NAMES.test(String((e && e.name) || ""));
// which kinds the browser lists no device of: {mic, cam} (true = none); null when it cannot say
export async function devicesMissing() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return { mic: !all.some((d) => d.kind === "audioinput"), cam: !all.some((d) => d.kind === "videoinput") };
  } catch (e) { return null; }
}
