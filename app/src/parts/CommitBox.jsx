// A box whose value counts only when it is finished: when the box is left, Enter is pressed in some browsers, or a
// value is picked from a list that drops down under it — the browser's "change" event. Then onCommit(value) runs.
// onCommit returns false to refuse the value: the box then shows `value` again. Until then what is typed stays in the
// box only (nothing is saved or redrawn on each key), as with the old screens' boxes.
import { useEffect, useRef } from "react";

export default function CommitBox({ value = "", onCommit, as: Tag = "input", type = "text", ...rest }) {
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
  return <Tag ref={el} {...(Tag === "input" ? { type } : {})} defaultValue={shown} {...rest} />;
}
