package main

// The final review of next-fix-linkedguid: reads and postings use ONE rule for whose Tally is this user's own
// (linkguid.go tallyToPost over ownersUntold): a Tally whose owner Windows cannot tell counts only while Windows tells the
// owner of no Tally in the list. The recorder's own-Tally record (ports.go), the ledger and masters reads' own port
// (ledOwnPort, the masters retry), the daily catch-up's open companies and the kept-books run's company list follow it;
// such a company's masters wait says the posting's own words. On a plain PC where no owner is known, everything reads as
// before. Made-up companies and fake Tallies only.

import (
	"fmt"
	"sort"
	"strings"
	"testing"
)

const orUntold = "has it open, but Windows cannot tell whose Tally that is (it may be running as administrator), so nothing is sent to it; run Tally normally as your own Windows user"

// two Tallies on one server: this user's own (session 1, "ZZ TEST") and one whose owner Windows cannot tell ("ZZ OTHER");
// plain: only the owner-unknown one (a plain single-user PC where Windows tells no owner)
func orSetup(t *testing.T, plain bool) (own, untold *standTally) {
	t.Helper()
	own, untold = newStandTally(t), newStandTally(t)
	untold.coName, untold.guid = "ZZ OTHER", "co-guid-other"
	standBridge(t, own, "")
	if plain {
		r253Server(t, `{"pid": 11, "name": "tally", "session": 0, "sessionUnknown": true}`, fmt.Sprintf(`{"port": %d, "pid": 11}`, untold.port))
	} else {
		r253Server(t, `{"pid": 10, "name": "tally", "session": 1}, {"pid": 11, "name": "tally", "session": 0, "sessionUnknown": true}`,
			fmt.Sprintf(`{"port": %d, "pid": 10}, {"port": %d, "pid": 11}`, own.port, untold.port))
	}
	openCompanies(true)
	return own, untold
}

func orLiveOpen(guid, name string) bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	return liveOwnOpenNow(guid, name)
}

func orNames(ocs []keepOC) []string {
	var n []string
	for _, o := range ocs {
		n = append(n, o.name)
	}
	sort.Strings(n)
	return n
}

func TestOwnRuleReadsShared(t *testing.T) {
	own, untold := orSetup(t, false)
	// the posting's rule, for the record
	h, err := linkedIn(openCompaniesCached(), "co-guid-other", "ZZ OTHER")
	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("Tally on port %d %s", untold.port, orUntold)) {
		t.Fatalf("the posting into the owner-unknown Tally was not refused with its words: %v %v", h, err)
	}
	// the recorder's own-Tally record
	if orLiveOpen("co-guid-other", "ZZ OTHER") || orLiveOpen("", "ZZ OTHER") {
		t.Fatal("the owner-unknown Tally's company counted as open in this user's own Tally while another owner is known")
	}
	if !orLiveOpen(own.guid, "ZZ TEST") {
		t.Fatal("this user's own company not counted open")
	}
	// the ledger and masters reads' own port, and the masters wait in the posting's words
	if p, why := ledOwnPort("ZZ OTHER", "co-guid-other", 0); p != 0 || why != fmt.Sprintf("Tally on port %d %s", untold.port, orUntold) {
		t.Fatalf("ledOwnPort read the owner-unknown Tally, or said other words: %d %q", p, why)
	}
	if why := mrOwnTally("ZZ OTHER", untold.port); why != fmt.Sprintf("Tally on port %d %s", untold.port, orUntold) {
		t.Fatalf("the masters retry's reason: %q", why)
	}
	if p, why := ledOwnPort("ZZ TEST", own.guid, 0); p != own.port || why != "" {
		t.Fatalf("this user's own company: %d %q", p, why)
	}
	// the daily catch-up and the kept-books run
	if got := dcOwnOpen(); len(got) != 1 || got[0] != "ZZ TEST" {
		t.Fatalf("the daily catch-up's open companies: %v", got)
	}
	if got := orNames(keepOpenOf(openCompaniesCached(), nil, nil)); len(got) != 1 || got[0] != "ZZ TEST" {
		t.Fatalf("the kept-books run's open companies: %v", got)
	}
}

// a plain single-user PC: Windows tells no owner; everything reads as today
func TestOwnRuleReadsPlainPC(t *testing.T) {
	_, untold := orSetup(t, true)
	if !orLiveOpen("co-guid-other", "ZZ OTHER") {
		t.Fatal("plain PC: the company not counted open in the own Tally")
	}
	if p, why := ledOwnPort("ZZ OTHER", "co-guid-other", 0); p != untold.port || why != "" {
		t.Fatalf("plain PC: ledOwnPort: %d %q", p, why)
	}
	if why := mrOwnTally("ZZ OTHER", untold.port); why != "" {
		t.Fatalf("plain PC: the masters retry refused: %q", why)
	}
	if got := dcOwnOpen(); len(got) != 1 || got[0] != "ZZ OTHER" {
		t.Fatalf("plain PC: the daily catch-up's open companies: %v", got)
	}
	if got := orNames(keepOpenOf(openCompaniesCached(), nil, nil)); len(got) != 1 || got[0] != "ZZ OTHER" {
		t.Fatalf("plain PC: the kept-books run's open companies: %v", got)
	}
	if h, err := linkedIn(openCompaniesCached(), "co-guid-other", "ZZ OTHER"); err != nil || h.port != untold.port {
		t.Fatalf("plain PC: the posting: %v %v", h, err)
	}
}

// the kept-books run's list: another user's Tally (not skipped: OnlyMySession off) never; the companies wanted only
func TestOwnRuleKeepList(t *testing.T) {
	co := func(n string) []any { return []any{M{"name": n, "from": "20260401"}} }
	ss := []M{
		{"port": 9000, "ok": true, "mine": true, "companies": co("A Co")},
		{"port": 9001, "ok": true, "mine": false, "companies": co("B Co")},
		{"port": 9002, "ok": true, "companies": co("C Co")},
		{"port": 9003, "ok": true, "mine": true, "skipped": true, "companies": co("D Co")},
		{"port": 9004, "ok": false, "mine": true, "companies": co("E Co")},
	}
	if got := orNames(keepOpenOf(ss, nil, nil)); strings.Join(got, ",") != "A Co" {
		t.Fatalf("shared: %v", got)
	}
	if got := orNames(keepOpenOf(ss[2:3], nil, nil)); strings.Join(got, ",") != "C Co" {
		t.Fatalf("plain: %v", got)
	}
	if got := orNames(keepOpenOf(ss, []string{"B Co"}, nil)); len(got) != 0 {
		t.Fatalf("wanted another user's: %v", got)
	}
	if got := keepOpenOf(ss, nil, []string{"A Co"}); len(got) != 1 || got[0].port != 9000 || got[0].from != "20260401" {
		t.Fatalf("only A Co: %v", got)
	}
}

// the beat's openElsewhere: the same port and why as the posting's words (elsewhereWords): the owner-unknown Tally first,
// whichever the list names first
func TestBeatOpenElsewherePrefersUntold(t *testing.T) {
	bridgeFor(t, &standIn{}, "")
	ss := []M{
		{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
		{"port": 9001, "ok": true, "mine": false, "companies": []any{M{"name": "B Co", "guid": "g9"}}},
		{"port": 9002, "ok": true, "companies": []any{M{"name": "b co", "guid": "g9"}}},
	}
	var b M
	for _, x := range beatCompanies(ss, []any{"A Co", "B Co", "b co"}) {
		if o := obj(x); companyKey(str(o["name"])) == companyKey("B Co") {
			b = o
		}
	}
	oe := obj(b["openElsewhere"])
	if oe == nil || toInt(oe["port"]) != 9002 || str(oe["why"]) != "owner unknown" {
		t.Fatalf("the beat named another Tally than the posting's words: %v", b)
	}
	if w := elsewhereWords(ss, "g9", false); !strings.Contains(w, "Tally on port 9002 has it open") {
		t.Fatalf("the posting's words: %q", w)
	}
}
