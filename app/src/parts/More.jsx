// "More" (the TDS & GST makeover, 11-Oct-2026): the rare actions and the long explanations of a page, out of sight until
// asked for. A native <details>, so it opens with a click or the keyboard and needs no portal; a click on an action
// inside closes it again. items: [label, onClick, props?]; children: words shown inside, under the actions.
import { useRef } from "react";

export default function More({ label = "More", items = [], children, align = "end", ...rest }) {
  const ref = useRef(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  const list = items.filter(Boolean);
  if (!list.length && !children) return null;
  return <details className="more" data-align={align} ref={ref} {...rest}>
    <summary className="btn small more-btn" aria-label={label}>{label}<span aria-hidden="true" className="more-caret">▾</span></summary>
    <div className="more-pop" role="group" aria-label={label}>
      {list.map(([l, go, props], i) => <button key={i} type="button" className="more-item" onClick={() => { close(); go(); }} {...(props || {})}>{l}</button>)}
      {children && <div className="more-words">{children}</div>}
    </div>
  </details>;
}
