// Pieces the billing screens share: money in paise shown as rupees, a rupee box that gives paise, status chips, the
// dialogs' own idempotency key (a money dialog pressed twice changes nothing), and the plan/status words.
import { useState } from "react";
import { Chip, ReasonButton } from "../../ui/bits.jsx";
import "./billing.css";

export const inr = (rupees) => (rupees === null || rupees === undefined || rupees === "" ? "–"
  : (Number(rupees) < 0 ? "−₹" : "₹") + Math.abs(Number(rupees)).toLocaleString("en-IN", { minimumFractionDigits: Number(rupees) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
export const fromPaise = (p) => (p === null || p === undefined ? null : Number(p) / 100);
export const inrPaise = (p) => inr(fromPaise(p));
// "1,250.50" or "1250.5" -> 125050 paise; "" -> null; NaN when it is not an amount
export function toPaise(text) {
  const s = String(text ?? "").replace(/[,₹\s]/g, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);

export const SUB_STATUS = [
  { value: "trial", label: "Trial" }, { value: "active", label: "Active" }, { value: "past_due", label: "Past due" },
  { value: "read_only", label: "Read-only" }, { value: "paused", label: "Paused" }, { value: "cancelled", label: "Cancelled" },
];
const TONE = { trial: "neutral", active: "good", past_due: "warn", read_only: "bad", paused: "bad", cancelled: "neutral" };
export function SubChip({ status }) {
  return <Chip tone={TONE[status] || "neutral"} testid="sub-chip">{(SUB_STATUS.find((s) => s.value === status) || { label: status || "–" }).label}</Chip>;
}
export const KINDS = [
  { value: "topup", label: "Top-up" }, { value: "charge", label: "Charge" }, { value: "fee", label: "Monthly fee" }, { value: "refund", label: "Refund" },
  { value: "adjust", label: "Adjustment" }, { value: "opening", label: "Opening" }, { value: "signup_credit", label: "Sign-up credit" },
  { value: "coupon_credit", label: "Coupon credit" }, { value: "discount", label: "Discount" }, { value: "credit", label: "Credit (old)" },
];
export const PAY_MODES = [{ value: "bank", label: "Bank transfer" }, { value: "upi", label: "UPI" }, { value: "cheque", label: "Cheque" }, { value: "cash", label: "Cash" }, { value: "gateway", label: "Payment gateway" }, { value: "other", label: "Other" }];
export const CATEGORIES = [{ value: "goodwill", label: "Goodwill" }, { value: "correction", label: "Correction" }, { value: "test_cleanup", label: "Test clean-up" }, { value: "other", label: "Other" }];
export const ITEMS = ["bills", "bank", "sales", "claude", "vision", "clients", "cloud", "tally", "plan", "wallet"];

// a rupee box: shows what was typed, keeps paise in m[key]
export function RupeeField({ label, m, set, k, hint, testid, allowNegative = false }) {
  const t = m["_" + k] ?? "";
  const p = toPaise(t);
  const bad = t !== "" && (Number.isNaN(p) || (!allowNegative && p < 0));
  return (
    <label className="field"><span>{label}</span>
      <input className="input" inputMode="decimal" value={t} data-testid={testid} aria-invalid={bad || undefined}
             onChange={(e) => { const v = e.target.value, q = toPaise(v); set({ ...m, ["_" + k]: v, [k]: Number.isNaN(q) ? undefined : q }); }} />
      {bad ? <span className="small note-bad">Type an amount in rupees, e.g. 5000 or 1,250.50</span> : hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}
export const Select = ({ label, value, onChange, options, testid }) => (
  <label className="field"><span>{label}</span>
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);
// a money action's button: its dialog carries its own key, new after each success, so a double press is one change
export function MoneyButton({ params, onDone, ...rest }) {
  const [key, setKey] = useState(newKey);
  return <ReasonButton {...rest} params={{ ...params, key }} onDone={(d) => { setKey(newKey()); onDone && onDone(d); }} />;
}
