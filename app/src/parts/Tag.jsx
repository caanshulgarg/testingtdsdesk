// A small tag of a state (FinCom's "tag ok / warn / bad / stamp / info / no"), drawn by Arc's Badge
// (src/arc/registry/components/badge). The "tag <kind>" classes stay on it for the old code and the tests.
import { Badge } from "@/registry/components/badge/badge";

const TONE = { ok: "success", warn: "warning", bad: "danger", stamp: "info", info: "info", no: "neutral" };
export default function Tag({ kind = "no", className = "", children, ...rest }) {
  return <Badge tone={TONE[kind] || "neutral"} size="sm" className={("tag " + kind + " " + className).trim()} data-arc="badge" data-kind={kind} {...rest}>{children}</Badge>;
}
