// The derived party (branch next-push, 2.4.0). The full line is the voucher FORM at Form Accept; a receipt, payment, contra
// or journal whose form names no party is stored by Tally WITH one, worked out from its ledger lines: the first ledger
// under Sundry Debtors or Sundry Creditors, else the first under Cash-in-Hand or a bank group (Bank Accounts, Bank OD A/c,
// Bank OCC A/c), else none. tally-versions runs 37722273938 .. 37754251128 (each kind typed on Tally's screens, 3.0-7.1):
// 75 of 75 stored parties.
//
// The bridge fills that party from the ledger and group lists it already holds (the keep's ledger round: ledger-list.json
// and group-list.json in the company's folder; no request of its own, nothing new asked of Tally). When a line's ledger is
// not in the list held here (a ledger made since the last round), or no list is held, the party cannot be told: the line
// is not taken and the fast request (FinComVoucherObject) confirms the entry, as the trust rule does. A party the form
// names is kept as it is.
package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// the groups whose ledgers Tally takes as the party (lower case: Tally names the group "Cash-in-hand")
var (
	pushPartyGroups    = []string{"sundry debtors", "sundry creditors"}
	pushCashBankGroups = []string{"cash-in-hand", "bank accounts", "bank od a/c", "bank occ a/c"}
)

// the party Tally stores for the entry, "" for none; why: "" when it is told, else why it cannot be. leds: a ledger's
// group by its name (lower case); grps: a group's parent by its name (lower case; "" for a primary group)
func pushDeriveParty(e *pushEntry, leds, grps map[string]string) (string, string) {
	if p := strings.TrimSpace(e.s("party")); p != "" {
		return e.s("party"), ""
	}
	keys := e.list("", "L")
	if len(keys) == 0 {
		return "", ""
	}
	if len(leds) == 0 {
		return "", "the form names no party and no ledger list is held here to tell Tally's"
	}
	under := func(group string, set []string) bool {
		g := strings.ToLower(strings.TrimSpace(group))
		for i := 0; g != "" && i < 30; i++ {
			for _, s := range set {
				if g == s {
					return true
				}
			}
			g = strings.ToLower(strings.TrimSpace(grps[g]))
		}
		return false
	}
	var names, groups []string
	for _, k := range keys {
		n := e.recs[k]["led"]
		g, ok := leds[strings.ToLower(strings.TrimSpace(n))]
		if !ok {
			return "", "the form names no party and ledger " + cutRunes(n, 80) + " is not in the ledger list held here"
		}
		names, groups = append(names, n), append(groups, g)
	}
	for _, set := range [][]string{pushPartyGroups, pushCashBankGroups} {
		for i := range names {
			if under(groups[i], set) {
				return names[i], ""
			}
		}
	}
	return "", ""
}

// the ledger and group lists held for a company (lower-case names), read again only when their files change
type pushPartyLists struct {
	stamp      string
	leds, grps map[string]string
}

var pushPartyCache = struct {
	sync.Mutex
	m map[string]*pushPartyLists
}{m: map[string]*pushPartyLists{}}

func pushPartyListsOf(company string) (map[string]string, map[string]string) {
	dir, err := companyDir(company)
	if err != nil {
		return nil, nil
	}
	stamp := ""
	for _, f := range []string{ledListFile(dir), filepath.Join(dir, "group-list.json")} {
		if st, err := os.Stat(f); err == nil {
			stamp += st.ModTime().Format(time.RFC3339Nano) + "/" + st.Name() + "/" + strconv.FormatInt(st.Size(), 10) + ";"
		}
	}
	pushPartyCache.Lock()
	defer pushPartyCache.Unlock()
	if c := pushPartyCache.m[dir]; c != nil && c.stamp == stamp {
		return c.leds, c.grps
	}
	leds, grps := map[string]string{}, map[string]string{}
	for _, r := range loadLedList(dir) {
		if n := strings.ToLower(strings.TrimSpace(r.name)); n != "" {
			leds[n] = r.parent
		}
	}
	for _, x := range arr(readJSONFile(filepath.Join(dir, "group-list.json"))) {
		a := arr(x)
		if n := strings.ToLower(strings.TrimSpace(str(at(a, 0)))); n != "" {
			grps[n] = str(at(a, 1))
		}
	}
	pushPartyCache.m[dir] = &pushPartyLists{stamp, leds, grps}
	return leds, grps
}

// the bank groups: a ledger under one of them is a bank line (Cash-in-Hand is not: Tally makes no bank allocation for it)
var pushBankGroups = []string{"bank accounts", "bank od a/c", "bank occ a/c"}

// whether a group (lower case or not) is one of set or under one of them, by the groups held
func pushUnder(group string, set []string, grps map[string]string) bool {
	g := strings.ToLower(strings.TrimSpace(group))
	for i := 0; g != "" && i < 30; i++ {
		for _, s := range set {
			if g == s {
				return true
			}
		}
		g = strings.ToLower(strings.TrimSpace(grps[g]))
	}
	return false
}

// share run 37795355169 (3.0 .. 7.1): an entry made new with a line under a bank group is stored with a bank allocation
// Tally makes as it stores it (the transaction type, a unique reference of its own, the date), which the form at Form
// Accept does not hold. Such a line without its bank details (K records) is not taken; nor is a new entry whose ledger the
// lists held here do not have (whether it is a bank line cannot be told). An alteration's form holds the stored details.
// "" when the line can be taken
func pushBankCheck(e *pushEntry, ev string, leds, grps map[string]string) string {
	if ev != "created" {
		return ""
	}
	for _, k := range e.list("", "L") {
		n := e.recs[k]["led"]
		g, ok := leds[strings.ToLower(strings.TrimSpace(n))]
		if !ok {
			return "a new entry whose ledger " + cutRunes(n, 80) + " is not in the ledger list held here (whether it is a bank line, whose details Tally makes as it stores the entry, is not known)"
		}
		if pushUnder(g, pushBankGroups, grps) && len(e.list(k, "K")) == 0 {
			return "a new entry with a bank line (" + cutRunes(n, 80) + ") and no bank details: Tally makes them as it stores the entry"
		}
	}
	return ""
}
