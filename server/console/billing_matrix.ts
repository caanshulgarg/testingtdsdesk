// The billing module's permission matrix, written from console-plan.md 2.4 (not read from the code), and a valid call
// for each action against tests/console_billing_fake.ts. handler_test.ts adds both to its every-role-x-every-action test.
import { type Role } from "./core/types.ts";

const ALL: Role[] = ["owner", "billing", "support", "viewer"];
const OB: Role[] = ["owner", "billing"];
export const BILLING_EXPECT: Record<string, Role[]> = {
  "plans.list": ALL, "plan.get": ALL, "plan.save": OB,
  "prices.list": ALL, "price.history": ALL, "price.set": OB,
  "subs.list": ALL, "sub.get": ALL, "sub.change_plan": OB, "sub.set_status": OB,
  "ledger.list": ["owner", "billing", "viewer"], "firm.ledger": ALL,          // Support: one firm's ledger only
  "credit.topup": OB, "credit.refund": OB, "credit.adjust": OB,
  "ledger.check": ["owner", "billing", "viewer"], "ledger.fix": ["owner"],
  "cleanup.list": ["owner"], "cleanup.test_credit": ["owner"],
  "billing.run": OB, "billing.runs": ["owner", "billing", "viewer"],
  "settings.billing.get": OB, "settings.billing.set": ["owner"],
};
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const B_FIRM = U(101), B_FIRM2 = U(102), PLAN_PAYG = U(901), PLAN_ALL = U(903);
const R = "a good reason";
export const TODAY = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const BILLING_PARAMS: Record<string, Record<string, unknown>> = {
  "plan.get": { plan_id: PLAN_PAYG },
  "plan.save": { plan: { name: "Small firm", monthly_fee_paise: 150000, features: ["300 bills"] }, reason: R },
  "price.history": { item: "bills" },
  "price.set": { item: "otp", price_paise: 25, effective_from: TODAY, reason: R },
  "sub.get": { firm_id: B_FIRM },
  "sub.change_plan": { firm_id: B_FIRM, plan_id: PLAN_ALL, reason: R },
  "sub.set_status": { firm_id: B_FIRM, status: "paused", reason: R },
  "firm.ledger": { firm_id: B_FIRM },
  "credit.topup": { firm_id: B_FIRM, amount_paise: 50000, pay_mode: "upi", pay_ref: "UTR-1", reason: R },
  "credit.refund": { entry_id: 2, key: "dialogkey01", reason: R },
  "credit.adjust": { firm_id: B_FIRM, amount_paise: -100, category: "correction", key: "adjkey0001", reason: R },
  "ledger.fix": { firm_id: B_FIRM2, reason: R },
  "cleanup.test_credit": { firm_id: B_FIRM, target_paise: 1000000, reason: R },
  "billing.run": { mode: "month", reason: R },
  "settings.billing.set": { value: { grace_days: 5 }, reason: R },
};
