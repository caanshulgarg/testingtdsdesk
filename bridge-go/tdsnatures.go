// FinCom Bridge 2.4.3 (the owner's approval of 11-Oct-2026, (b)): the TDS settings Tally keeps on its masters, read with
// the ledger list (Update now, the nightly run) and sent with it:
//   - on the ledger list's rows (FinComLedgers, FinComLedgerChanges, FinComLedgerByName: ledFetch): a TDS duty ledger's
//     nature of payment (TDSRATENAME); a party's special rate (TDSDEDUCTEEISSPECIALRATE / TDSDEDUCTEESPECIALRATE) and its
//     lower-deduction certificates (LOWERDEDUCTION.LIST: the nature; LOWERDEDUCTIONDETAILS.LIST: from, to, section,
//     certificate number, rate, limit);
//   - the natures of payment themselves (FinComTdsNatures: Tally's TDSRate masters, a few dozen in a company): each
//     nature's section, its rates (with and without PAN, individual / HUF and others) and its thresholds (the yearly
//     limit EXEMPTIONLIMIT and the single bill's SINGLEBILLVALUE), by the date each applies from (CATEGORYDETAILS.LIST).
//
// Stored master fields only, nothing Tally works out; read only; in chunks of MasterIDs (NatureChunk, 5,000 a request:
// the natures are few, each request reads Tally's TDSRate masters alone) up to the company's highest master number, then
// one last request with no upper end, as the ledger list; one request in flight through the one gate to Tally, inside
// the keep round's budget and stops (the company open, nothing posting). A nature request Tally does not answer never
// holds the ledger list: the round goes on without the natures (they are not sent that round), and after two such
// rounds the natures are not asked again until the bridge's version changes.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	natListID = "FinComTdsNatures"
	natFetch  = "GUID, MASTERID, ALTERID, NAME, CATEGORYDETAILS.APPLICABLEFROM, CATEGORYDETAILS.TDSRATESECTION, CATEGORYDETAILS.RATEOFTAX, " +
		"CATEGORYDETAILS.OTHERRATE, CATEGORYDETAILS.NOPANRATEOFTAX, CATEGORYDETAILS.NOPANOTHERRATE, CATEGORYDETAILS.EXEMPTIONLIMIT, CATEGORYDETAILS.SINGLEBILLVALUE"
)

func natChunk() int { return keepNum("NatureChunk", 5000) }

func natureChunkRequest(company string, after, upto int64) string {
	return fcCollection(natListID, company, "", "TDSRate", natFetch, masterRange(after, upto))
}

// --- what a ledger carries (ledRowsOf)

// a value as Tally keeps it, trimmed and cut
func tdsText(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		s = s[:n]
	}
	return s
}

// the party's special rate ("" when Tally's TDSDEDUCTEEISSPECIALRATE is not Yes)
func ledSpecial(l *Node) string {
	if !strings.EqualFold(nt(l, "TDSDEDUCTEEISSPECIALRATE"), "Yes") {
		return ""
	}
	return tdsText(nt(l, "TDSDEDUCTEESPECIALRATE"), 20)
}

// the party's lower-deduction certificates as JSON text, [[nature, from, to, section, certificate, rate, limit], ...] in
// Tally's order (at most 50); "" when it has none (a detail with nothing in it is no certificate)
func ledLDC(l *Node) string {
	var o [][]string
	for _, x := range l.Sel("LOWERDEDUCTION.LIST") {
		nature := tdsText(nt(x, "NATUREOFPAYMENT"), 200)
		for _, d := range x.Sel("LOWERDEDUCTIONDETAILS.LIST") {
			r := []string{nature, tdsText(nt(d, "FROMDATE"), 20), tdsText(nt(d, "TODATE"), 20), tdsText(nt(d, "SECTIONNO"), 20),
				tdsText(nt(d, "CERTIFICATENO"), 60), tdsText(nt(d, "TDSITRATE"), 20), tdsText(nt(d, "LOWERDEDUCTIONLIMIT"), 30)}
			if strings.Join(r[1:], "") == "" {
				continue
			}
			if len(o) < 50 {
				o = append(o, r)
			}
		}
	}
	if len(o) == 0 {
		return ""
	}
	b, _ := json.Marshal(o)
	return string(b)
}

// the three columns a 2.4.3 ledger row adds (ledger_list, ledger_changes): the nature of payment, the special rate and the
// certificates as a list
func ledTDSCols(nature, special, ldc string) []any {
	var l []any
	if ldc != "" {
		_ = json.Unmarshal([]byte(ldc), &l)
	}
	if l == nil {
		l = []any{}
	}
	return []any{nature, special, l}
}

// --- the natures of payment

// one nature: [guid, MasterID, AlterID, name, [[from, section, rate, other rate, rate without PAN, other rate without PAN,
// yearly threshold, single bill threshold], ...]]
func natRowsOf(raw string) ([]any, int64) {
	var out []any
	var top int64
	for _, n := range xmlDoc(raw).All("TDSRATE") {
		name, g := tdsText(nameOf(n), 200), cleanGUID(nt(n, "GUID"))
		if name == "" || g == "" {
			continue
		}
		cats := []any{}
		for _, c := range n.Sel("CATEGORYDETAILS.LIST") {
			r := []any{tdsText(nt(c, "APPLICABLEFROM"), 20), tdsText(nt(c, "TDSRATESECTION"), 20), tdsText(nt(c, "RATEOFTAX"), 20), tdsText(nt(c, "OTHERRATE"), 20),
				tdsText(nt(c, "NOPANRATEOFTAX"), 20), tdsText(nt(c, "NOPANOTHERRATE"), 20), tdsText(nt(c, "EXEMPTIONLIMIT"), 30), tdsText(nt(c, "SINGLEBILLVALUE"), 30)}
			if len(cats) < 20 {
				cats = append(cats, r)
			}
		}
		mid := digits(nt(n, "MASTERID"))
		if mid > top {
			top = mid
		}
		out = append(out, []any{g, mid, digits(nt(n, "ALTERID")), name, cats})
	}
	return out, top
}

// the natures, read inside the ledger round (ledgerList) after the groups: true when read (or given up for this round);
// false with the error only when the request gave way (a posting, FinCom's stop): any other failure skips the natures this round
func (k *keepRun) natureList(company string, port int, st, ls M, inBudget func() bool, save func()) (bool, error) {
	if truthy(ls["natDone"]) {
		return true, nil
	}
	if str(st["natOffVer"]) == BridgeVersion {
		ls["natDone"], ls["natSkip"] = true, true
		save()
		return true, nil
	}
	for !truthy(ls["natDone"]) {
		if !inBudget() || keepHold() != "" {
			return false, nil
		}
		after, bound := toI64(ls["natAfter"]), toI64(ls["bound"])
		tail := bound <= 0 || after >= bound
		upto := after + int64(natChunk())
		if tail {
			upto = 0
		}
		t1 := time.Now()
		raw, err := invokeTally(k.tc, port, natureChunkRequest(company, after, upto), ledChunkSec())
		if err == nil && !strings.Contains(raw, "<ENVELOPE") {
			err = fmt.Errorf("Tally's answer to the natures of payment could not be read: %s", cut(flat(raw), 120))
		}
		if err != nil {
			if gaveWay(err) {
				return false, err // not sent (a posting, FinCom's stop): the round goes on later, as the ledgers' would
			}
			// any other failure never holds the ledger list: it goes on without the natures this round. Tally not
			// answering twice: not asked again until the bridge is updated
			if tallyNoAnswer(err) {
				st["natMiss"] = toInt(st["natMiss"]) + 1
			}
			if toInt(st["natMiss"]) >= 2 {
				st["natOffVer"], st["natMiss"] = BridgeVersion, 0
				writeLog(fmt.Sprintf("Keeping %s: Tally did not answer the natures of payment twice; they are not asked again until the bridge is updated (the ledger list goes on)", company))
			} else {
				writeLog(fmt.Sprintf("Keeping %s: the natures of payment were not read (%s); the ledger list goes on without them this time", company, cut(err.Error(), 200)))
			}
			ls["natDone"], ls["natSkip"], ls["nat"] = true, true, nil
			save()
			return true, nil
		}
		rows, top := natRowsOf(raw)
		ls["nat"] = append(arr(ls["nat"]), rows...)
		ls["reqs"] = toInt(ls["reqs"]) + 1
		if tail {
			ls["natDone"] = true
			delete(st, "natMiss")
		} else {
			ls["natAfter"] = upto
			if top > bound {
				ls["bound"] = top
			}
		}
		save()
		sec := time.Since(t1).Seconds()
		writeLog(fmt.Sprintf("Keeping %s: natures of payment MasterID %d-%s, %d (%.1fs)", company, after+1, map[bool]string{true: "end", false: fmt.Sprint(upto)}[tail], len(rows), sec))
		keepRest(time.Duration(maxI(200, int(sec*500))) * time.Millisecond)
	}
	return true, nil
}

// the natures read in a round, once each by GUID (the last read wins); nil when the round gave them up
func natOfRound(ls M) []any {
	if truthy(ls["natSkip"]) || !truthy(ls["natDone"]) {
		return nil
	}
	by, order := map[string]any{}, []string{}
	for _, x := range arr(ls["nat"]) {
		g := str(at(arr(x), 0))
		if g == "" {
			continue
		}
		if _, had := by[g]; !had {
			order = append(order, g)
		}
		by[g] = x
	}
	o := []any{}
	for _, g := range order {
		o = append(o, by[g])
	}
	return o
}
