// A box whose value counts only when it is finished: when the box is left, Enter is pressed in some browsers, or a
// value is picked from a list that drops down under it — the browser's "change" event. Then onCommit(value) runs.
// onCommit returns false to refuse the value: the box then shows `value` again. Until then what is typed stays in the
// box only (nothing is saved or redrawn on each key), as with the old screens' boxes.
// Drawn as Arc's text field (src/arc/registry/components/input: its border, corners and focus); a date (type="date")
// is FinCom's DateBox (01-Oct-2026, Arc's calendar), committed the same way.
import { useEffect, useRef } from "react";
import DateBox from "./DateBox.jsx";
import arc from "@/registry/components/input/input.module.css";

export default function CommitBox(props) {
  if (props.type === "date" && (props.as || "input") === "input") {
    const { value = "", onCommit, type, as, ...rest } = props;
    return <DateBox value={value == null ? "" : String(value)} onCommit={onCommit} {...rest} />;
  }
  return <TextBox {...props} />;
}

function TextBox({ value = "", onCommit, as: Tag = "input", type = "text", className, ...rest }) {
  const el = useRef(null), commit = useRef(onCommit);
  commit.current = onCommit;
  const shown = value == null ? "" : String(value);
  useEffect(() => {
    const box = el.current;
    const changed = () => { if (commit.current && commit.current(box.value) === false) box.value = shown; };
    box.addEventListener("change", changed);
    return () => box.removeEventListener("change", changed);
  }, [shown]);
  // a new value from outside (a rule, undo, another person) replaces what is shown, unless the box is being typed in
  useEffect(() => { if (el.current && document.activeElement !== el.current) el.current.value = shown; }, [shown]);
  return <Tag ref={el} {...(Tag === "input" ? { type } : {})} defaultValue={shown} className={[arc.input, className].filter(Boolean).join(" ")} data-arc="input" {...rest} />;
}
