// A box for a Tally ledger name, with the ledger list that drops down while typing (the old AC module in
// src/js/23 opens it for any input with data-ac). What is typed is kept in the box only; the choice is made when
// the box is left or a ledger is picked from the list — the browser's "change" event — and then onCommit(value)
// runs. onCommit returns false to refuse the name: the box then shows `value` again.
import { useEffect, useRef } from "react";

export default function LedgerBox({ value = "", onCommit, fk, className = "lgbox", ...rest }) {
  const el = useRef(null), commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const box = el.current;
    const changed = () => { if (commit.current && commit.current(box.value) === false) box.value = value; };
    box.addEventListener("change", changed);
    return () => box.removeEventListener("change", changed);
  }, [value]);
  // a new value from outside (a rule, undo, another person) replaces what is shown, unless the box is being typed in
  useEffect(() => { if (el.current && document.activeElement !== el.current) el.current.value = value; }, [value]);
  return <input ref={el} type="text" className={className} data-ac="1" data-fk={fk} autoComplete="off" defaultValue={value} {...rest} />;
}
