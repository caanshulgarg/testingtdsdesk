// The answer first (ui-tidy, 13-Oct-2026; the owner: "mis and reports are also very cluttered.. make this simple"):
//   <Answer figs={[[label, value, sub?, tone?], …]} />  at most four key figures in one row at the top of a page (more are
//                                                        refused: the fifth and on belong in a section below);
//   <Fold id title sub first>…</Fold>                    a section, folded unless it is the page's first (or opened before:
//                                                        S.folds keeps what the person opened or closed);
//   <Info>…</Info>                                       a small (i): the long explanation, shown on a click.
// Only placement: the figures are the page's own, worked out where they were before.
export const MAX_FIGS = 4;

export function Answer({ figs, label = "Key figures", ...rest }) {
  const list = (figs || []).filter(Boolean).slice(0, MAX_FIGS);
  if (!list.length) return null;
  // drawn as the page's tiles always were (.dash-tiles, .dtile), only fewer and first
  return <div className="dash-tiles answer" data-answer="" data-n={list.length} role="group" aria-label={label} {...rest}>
    {list.map(([l, v, sub, tone], i) => <div key={i} className={"dtile ans" + (tone ? " " + tone : "")} data-answer-fig={typeof l === "string" ? l : i}>
      <span>{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</div>)}
  </div>;
}

export function Fold({ id, title, sub, first = false, children, className = "", ...rest }) {
  const kept = (S.folds || {})[id], open = kept != null ? kept : first;
  const toggle = (ev) => { S.folds = S.folds || {}; S.folds[id] = ev.currentTarget.open; };
  return <details className={("fold " + className.replace(/\bfold\b/, "")).trim()} data-fold={id} open={open} onToggle={toggle} {...rest}>
    <summary><span>{title}</span>{sub ? <span className="fold-sub">{sub}</span> : null}</summary>
    <div className="fold-body">{children}</div>
  </details>;
}

export function Info({ children, label = "More about this" }) {
  return <details className="info" data-info=""><summary aria-label={label} title={label}>i</summary><div>{children}</div></details>;
}
