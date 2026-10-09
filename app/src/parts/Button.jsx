// FinCom's button, drawn by Arc's Button (src/arc/registry/components/button). It takes what a <button> takes, with
// FinCom's classes saying what it is: "btn", plus "primary" (the page's one main action), "danger" or "danger-fill"
// (removes something), "small". The classes stay on the button: the old click handlers, WhyNotes and the tests find
// buttons by them. type is "button" unless given (none of FinCom's buttons sends a form).
import { forwardRef } from "react";
import { Button as ArcButton } from "@/registry/components/button/button";

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
  const tone = toneOf(className);
  return <ArcButton ref={ref} type={type} variant={VARIANT[tone]} size={has(className, "small") ? "sm" : "md"}
    className={className} data-arc="button" data-tone={tone} {...rest} />;
});
export default Button;
