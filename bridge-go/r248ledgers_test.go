package main

// 29-Oct-2026 (staging, book 3d36a836, IMPETUS INSURANCE BROKERS PRIVATE LIMITED): bridge 2.4.8 on NW144\anshul sent a
// complete ledger round of 404 while bridge 2.4.7 on NW144\Ranjeet had sent 440 for the same book; the 36 not seen were
// all zero opening, never used, their MasterIDs spread between the others (0xda..0x335), among them names with a double
// space and with double quotes, in groups under every kind of primary group. A stand-in Tally with ledgers of exactly
// that kind: the bridge's ledger read (Update now and the ledgers-only read with its exact count) must list every one.

import (
	"fmt"
	"testing"
)

var impetusLike = []struct{ name, parent string }{
	{"Advertisement and Promotion", "Indirect Expenses"}, {"Battery", "Fixed Assets"}, {"CGST", "GST-UP"},
	{"Deferred Tax Liability", "Current Liabilities"}, {"Difference of Bill No. UP/2025-26/066", "GST-UP"},
	{"DIWALI GIFT EXP", "Indirect Expenses"}, {"Educational support services", "Indirect Expenses"},
	{"EQUITY SHARE CAPITAL", "Capital Account"}, {"EVOLVE ADVISORY SERVICES", "Sundry Creditors"},
	{`FD with AU Bank " 2506211998132071 "`, "FD with AU Bank"}, {"FIXED DEPOSIT WITH YES BANK-New", "Investments"},
	{"Impetus Insurence Brokers Pvt Ltd", "Branch / Divisions"}, {"INSURANCE ACADEMY FEES", "Indirect Expenses"},
	{"Invoice Issued But Book in Next Year", "Current Liabilities"}, {"KOTAK MAHINDRA BANK IBAI FEE", "Sundry Creditors"},
	{"Management Consulting and Services", "Indirect Expenses"}, {"Modi Battery", "Sundry Creditors"},
	{"Other support services", "Indirect Expenses"}, {"PURCHASE @18% IGST", "Purchase Accounts"},
	{"PURCHASE @18% LOCAL", "Purchase Accounts"}, {"PURCHASE @3% IGST", "Purchase Accounts"},
	{"PURCHASE IGST @ 28%", "Purchase Accounts"}, {"R  K Service Station Noida", "Sundry Creditors"},
	{"SGST", "GST-UP"}, {"Suspense A/c", "Suspense A/c"}, {"TDS DEPOSIT (F.Y.2024-25)", "TDS Payable"},
	{"TDS ON COMMISSION PAYABLE- Mismatch", "TDS Payable"}, {"TDS ON COMMISSION PAYABLE- Not Deposited", "TDS Payable"},
	{"TDS ON COMMISSION PAYABLE- Not Show in TDS Return", "TDS Payable"}, {"TDS ON PROFESSION- Not in Tds Return", "TDS Payable"},
	{"TDS ON SALARY DEPOSIT", "TDS Payable"}, {"TDS on Salary F.Y. 23-24", "TDS Payable"}, {"TDS PAYABLE", "Duties & Taxes"},
	{"TDS PAYABLE ON CONTRACT- Not in Tds Return", "TDS Payable"}, {"TDS PAYABLE ON RENT (Machinery) TY 2026-27 1009", "TDS Payable TY 2026-27"},
	{"Tds Receivable 2026-27", "Current Assets"},
}

func impetusTally(t *testing.T) (*standTally, map[string]bool) {
	f := newStandTally(t)
	f.grp = [][2]string{{"Sundry Creditors", "Current Liabilities"}, {"Current Liabilities", ""}, {"Indirect Expenses", ""},
		{"Fixed Assets", ""}, {"GST-UP", "Duties & Taxes"}, {"Duties & Taxes", "Current Liabilities"}, {"Capital Account", ""},
		{"FD with AU Bank", "Investments"}, {"Investments", ""}, {"Branch / Divisions", ""}, {"Purchase Accounts", ""},
		{"Suspense A/c", ""}, {"TDS Payable", "Duties & Taxes"}, {"TDS Payable TY 2026-27", "Duties & Taxes"}, {"Current Assets", ""}}
	want := map[string]bool{}
	// 404 others with entries or an opening, the 36 zero-opening unused ones spread between them (every 11th MasterID)
	k := 0
	for i := 1; i <= 440; i++ {
		if i%11 == 0 && k < len(impetusLike) {
			l := impetusLike[k]
			f.addLed(l.name, l.parent, "0.00")
			want[l.name] = true
			k++
			continue
		}
		name := fmt.Sprintf("Party %03d", i)
		f.addLed(name, "Sundry Debtors", fmt.Sprintf("-%d.00", i))
		want[name] = true
	}
	if k != 36 || len(want) != 440 {
		t.Fatalf("stand: %d special, %d in all", k, len(want))
	}
	return f, want
}

func TestImpetusLikeLedgersAllRead(t *testing.T) {
	for _, kind := range []string{"now", "ledgers"} {
		f, want := impetusTally(t)
		standBridge(t, f, `,"KeepBudgetSec":600`)
		liveFrom(today())
		if err := newRun(kind, "r-"+kind).step(zz, f.port, ""); err != nil {
			t.Fatal(err)
		}
		held := loadLedList(syncFolder(zz))
		got := map[string]bool{}
		for _, h := range held {
			got[h.name] = true
		}
		var missing []string
		for n := range want {
			if !got[n] {
				missing = append(missing, n)
			}
		}
		if len(held) != 440 || len(missing) != 0 {
			t.Fatalf("%s: %d ledgers held, %d missing: %v", kind, len(held), len(missing), missing)
		}
	}
}
