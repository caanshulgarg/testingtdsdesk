// The plain message when no microphone or camera reached this browser, and its "How" (Remote Desktop's redirection)
import { useState } from "react";
import { NO_DEVICE_TEXT, NO_DEVICE_STEPS } from "./noDevice.js";

export default function NoDeviceNote({ text, className }) {
  const [how, setHow] = useState(false);
  return <div className={"no-device-note " + (className || "")} role="note" data-no-device="">
    <span data-no-device-text="">{text || NO_DEVICE_TEXT}</span>{" "}
    <button type="button" className="linkbtn" aria-expanded={how} onClick={() => setHow(!how)} data-no-device-how="">{how ? "Hide" : "How"}</button>
    {how && <ol className="no-device-steps" data-no-device-steps="">{NO_DEVICE_STEPS.map((s, i) => <li key={i}>{s}</li>)}</ol>}
  </div>;
}
