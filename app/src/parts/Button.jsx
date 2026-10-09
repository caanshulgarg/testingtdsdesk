// FinCom's button in Arc's Button style (src/arc/registry/components/button: its stylesheet, variants and sizes). It
// takes what a <button> takes, with FinCom's classes saying what it is: "btn", plus "primary" (the page's one main
// action), "danger" or "danger-fill" (removes something), "small". The classes stay on the button: the old click
// handlers, WhyNotes and the tests find buttons by them. type is "button" unless given (no FinCom button sends a form).
//
// Arc's Button component wraps the label in three spans so a new label can morph in. FinCom takes Arc's reduced-motion
// path everywhere (src/arc/lib/calm-motion.js), where that morph is off, and its words must stay the button's own text:
// the tests find buttons by their exact words (button:text-is("Run now"), over a hundred times). So the button is a
// plain <button> with Arc's classes: the same look, without the spans.
import { forwardRef } from "react";
import arc from "@/registry/components/button/button.module.css";

const has = (cls, k) => (" " + cls + " ").includes(" " + k + " ");
// FinCom's kind of button -> Arc's variant
export function toneOf(cls) {
  if (has(cls, "primary")) return "primary";
  if (has(cls, "danger-fill")) return "danger-fill";
  if (has(cls, "danger")) return "danger";
  return "secondary";
}
const VARIANT = { primary: "primary", "danger-fill": "danger", danger: "danger", secondary: "secondary" };

const Button = forwardRef(function Button({ className = "btn", type = "button", ...rest }, ref) {
  const tone = toneOf(className), size = has(className, "small") ? "sm" : "md";
  return <button ref={ref} type={type} className={[arc.button, arc[VARIANT[tone]], arc[size], className].join(" ")}
    data-arc="button" data-tone={tone} {...rest} />;
});
export default Button;
