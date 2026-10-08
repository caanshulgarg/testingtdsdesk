package main

// next-bankdate (FinCom Bridge 2.4.0, the owner's agreed fallback). Setting a bank date in Tally's Bank Reconciliation fires
// NO add-on event (probe runs 37763910797, 37766812255, 37770857500, 37776378311, TallyPrime 3.0 .. 7.1): the voucher's
// AlterID jumps to the company's new ALTVCHID (ALTVCHID rises by exactly 1 per bank-dated voucher) and the bank date is
// stored (BANKALLOCATIONS.BANKERSDATE), which FinComVoucherObject's whole-voucher answer carries (an approved field the strip
// keeps). The stand Tally here does the same: a bank date set moves the voucher's AlterID and ALTVCHID, and no line is
// written. Written before the code (red first).

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// Tally sets a bank date on the voucher with this MasterID in Bank Reconciliation: no add-on line; its AlterID jumps to
// the company's next ALTVCHID
func bankSet(f *standTally, mid, day string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, v := range f.vch {
		if v.master == mid {
			f.alter++
			v.alter, v.bank = f.alter, day
		}
	}
}

// NWS144's bridge with the stand's ALTVCHID at the highest AlterID it holds (54392), its light check made: the bank
// route's first check (nothing asked: it starts from here)
func bankBridge(t *testing.T, extra string) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := r222bBridge(t, `,"BankGapMs":0,"BankNightGapMs":0`+extra)
	f.mu.Lock()
	f.alter = 54392
	f.mu.Unlock()
	bankCheck(t, f)
	if n := f.n("TDSDeskKeepList"); n != 0 {
		t.Fatalf("the first check asked the list %d times (it starts from the numbers it sees)", n)
	}
	return p, f, c
}

// the light check of NWS144 (FinComCompany) and the bank route after it, as startpoint.go runs them
func bankCheck(t *testing.T, f *standTally) {
	t.Helper()
	if _, err := companyCheck(fin, nwsCo, f.port); err != nil {
		t.Fatalf("the company check: %v", err)
	}
	bankAfterLightCheck(nwsCo, f.port)
}

func bankAsked(f *standTally) map[string]int { return renumAsked(f) }

// the bank-date lines FinCom took: MasterID -> lines
func bankSent(c *standCloud) map[string][]M {
	o := map[string][]M{}
	for _, s := range c.recSent() {
		if str(s["event"]) == "altered" && str(s["source"]) == "bankdate" {
			o[str(s["master_id"])] = append(o[str(s["master_id"])], s)
		}
	}
	return o
}

func bankLists(f *standTally) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, id := range f.reqs {
		if id == "TDSDeskKeepList" {
			o = append(o, f.bodies[i])
		}
	}
	return o
}

// --- 1. a small company: two bank dates set (ALTVCHID 54392 -> 54394, no add-on line): the light check sees ALTVCHID moved
// with nothing to explain it, asks the undated list above 54392 once, re-reads exactly those two with FinComVoucherObject
// once each (one at a time), and sends each as an altered line with Tally's entry carrying the bank date. Nothing more is
// asked at the next checks
func TestBankDateSmallRereadsChangedOnce(t *testing.T) {
	_, f, c := bankBridge(t, "")
	bankSet(f, "26311", "20261007")
	bankSet(f, "26312", "20261008")
	bankCheck(t, f)
	ls := bankLists(f)
	if len(ls) != 1 || !strings.Contains(ls[0], "$AlterID &gt; 54392") || strings.Contains(ls[0], "SVFROMDATE") || ls[0] != keepListAboveRequest(nwsCo, 54392) {
		t.Fatalf("the list asked: %v", ls)
	}
	for i := 0; i < 5; i++ {
		readAndUploadAll(t)
	}
	if a := bankAsked(f); fmt.Sprint(a) != fmt.Sprint(map[string]int{"26311": 1, "26312": 1}) {
		t.Fatalf("Tally asked %v (want 26311 and 26312 once each)", a)
	}
	s := bankSent(c)
	for mid, want := range map[string]string{"26311": "20261007", "26312": "20261008"} {
		l := s[mid]
		if len(l) != 1 || !strings.Contains(str(l[0]["xml"]), "BANKERSDATE") || !strings.Contains(str(l[0]["xml"]), want) || str(l[0]["object_guid"]) != r222GUID(toI64(mid)) {
			t.Fatalf("MasterID %s: sent %v (want one altered line with Tally's entry and its bank date %s)", mid, l, want)
		}
	}
	if len(s) != 2 {
		t.Fatalf("lines sent for %d entries: %v", len(s), s)
	}
	if str(s["26311"][0]["alter_id"]) != "54393" || str(s["26312"][0]["alter_id"]) != "54394" {
		t.Fatalf("AlterIDs sent: %v %v", s["26311"][0]["alter_id"], s["26312"][0]["alter_id"])
	}
	if f.maxFlight != 1 {
		t.Fatalf("%d requests at Tally at once", f.maxFlight)
	}
	// later checks, nothing changed: nothing asked
	n0 := f.n("")
	laterBy(t, 11*time.Minute)
	bankCheck(t, f)
	for i := 0; i < 3; i++ {
		readAndUploadAll(t)
	}
	if got := f.ids()[n0:]; len(got) != 1 || got[0] != "FinComCompany" {
		t.Fatalf("asked with nothing changed: %v", got)
	}
	if bankRoute(nwsCo) != "small" {
		t.Fatalf("route %q", bankRoute(nwsCo))
	}
}

// --- 2. ALTVCHID moved only by saves the add-on wrote lines for: nothing listed. A bank date on one entry and an altered
// save of another in the same stretch: the list is asked and only the bank-dated one is read by the bank route (the
// altered one is the add-on's: asked once, by its line)
func TestBankDateExplainedByAddonLines(t *testing.T) {
	p, f, c := bankBridge(t, "")
	alterSave := func(mid, no string) {
		f.mu.Lock()
		for _, v := range f.vch {
			if v.master == mid {
				f.alter++
				v.alter = f.alter
				v.narr = "changed " + no
			}
		}
		f.mu.Unlock()
		g := r222GUID(toI64(mid))
		liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"),
			r222Line("voucher_accept_post", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"))
	}
	alterSave("26311", "191")
	readAndUploadAll(t)
	bankCheck(t, f)
	if ls := bankLists(f); len(ls) != 0 {
		t.Fatalf("listed although the add-on's line explains the move: %v", ls)
	}
	laterBy(t, 11*time.Minute)
	bankSet(f, "26312", "20261009")
	alterSave("26311", "191")
	readAndUploadAll(t)
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if ls := bankLists(f); len(ls) != 1 {
		t.Fatalf("lists: %d", len(ls))
	}
	if a := bankAsked(f); a["26312"] != 1 || a["26311"] != 2 {
		t.Fatalf("Tally asked %v (want 26312 once by the bank route, 26311 once per add-on save)", a)
	}
	s := bankSent(c)
	if len(s) != 1 || len(s["26312"]) != 1 || !strings.Contains(str(s["26312"][0]["xml"]), "20261009") {
		t.Fatalf("bank lines: %v", s)
	}
}

// --- 3. a bank date set on an entry the add-on altered earlier in the same stretch (its body taken before the bank date):
// read again by the bank route (its AlterID is above the one the add-on's read took)
func TestBankDateAfterAddonSaveSameStretch(t *testing.T) {
	p, f, c := bankBridge(t, "")
	f.mu.Lock()
	f.alter++
	f.vch[1].alter = f.alter // 26311 altered: 54393
	f.mu.Unlock()
	g := r222GUID(26311)
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, "26311", "54391", "Receipt", "191", "5-Oct-2026", "altered"),
		r222Line("voucher_accept_post", "07:21", g, "26311", "54391", "Receipt", "191", "5-Oct-2026", "altered"))
	readAndUploadAll(t)
	bankSet(f, "26311", "20261010") // 54394, no line
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if a := bankAsked(f); a["26311"] != 2 {
		t.Fatalf("Tally asked %v (want 26311 twice: the add-on's save, then the bank date)", a)
	}
	s := bankSent(c)
	if len(s["26311"]) != 1 || str(s["26311"][0]["alter_id"]) != "54394" || !strings.Contains(str(s["26311"][0]["xml"]), "20261010") {
		t.Fatalf("bank lines: %v", s)
	}
}

// --- 4. a large company: the list stopped at the 2 s rule: the company goes to the nightly route (said once), nothing is
// re-read and nothing is asked again by day (no loop); at night (outside office hours, in the nightly window) the same
// list once, then the changed entries re-read and sent; by day after that: nothing
func TestBankDateLargeGoesNightly(t *testing.T) {
	_, f, c := bankBridge(t, `,"RecorderLimitMs":300,"BankNightLimitMs":3000,"RecorderStopCoolSec":0`)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskKeepList" {
			return 800 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	bankSet(f, "26311", "20261007")
	bankSet(f, "26312", "20261008")
	bankCheck(t, f)
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("lists %d", n)
	}
	if bankRoute(nwsCo) != "night" {
		t.Fatalf("route %q after the list stopped at the limit", bankRoute(nwsCo))
	}
	if !strings.Contains(readText(logFile()), "Bank dates: "+nwsCo+" goes to the nightly check") {
		t.Fatalf("the log does not say it:\n%s", readText(logFile()))
	}
	retryReset()
	for i := 0; i < 3; i++ {
		readAndUploadAll(t)
		bankNightTurn()
	}
	laterBy(t, 11*time.Minute)
	bankCheck(t, f)
	bankNightTurn()
	readAndUploadAll(t)
	if n := len(bankLists(f)); n != 1 || len(bankAsked(f)) != 0 {
		t.Fatalf("by day: %d lists, entries asked %v (want nothing more)", n, bankAsked(f))
	}
	// 02:30 the next morning (KeepDailyAt 02:00, NightlyWindowMin 240): the nightly check
	night := time.Date(2026, 10, 6, 2, 30, 0, 0, liveZone)
	nowFn = func() time.Time { return night }
	retryReset()
	bankCheck(t, f)
	bankNightTurn()
	for i := 0; i < 5; i++ {
		readAndUploadAll(t)
		bankNightTurn()
	}
	if n := len(bankLists(f)); n != 2 {
		t.Fatalf("lists %d (want one more at night)", n)
	}
	if a := bankAsked(f); fmt.Sprint(a) != fmt.Sprint(map[string]int{"26311": 1, "26312": 1}) {
		t.Fatalf("Tally asked %v at night", a)
	}
	if s := bankSent(c); len(s) != 2 {
		t.Fatalf("sent %v", s)
	}
	// again the same night: nothing
	night = night.Add(30 * time.Minute)
	bankCheck(t, f)
	bankNightTurn()
	readAndUploadAll(t)
	if n := len(bankLists(f)); n != 2 {
		t.Fatalf("lists %d (once a night)", n)
	}
}

// --- 5. the nightly route: stopped from FinCom (read stop): nothing asked; a posting going: nothing asked; once the stop
// is lifted and the posting done, it goes (the same night)
func TestBankDateNightStopAndPosting(t *testing.T) {
	_, f, c := bankBridge(t, "")
	bankForceNight(nwsCo)
	bankSet(f, "26311", "20261007")
	night := time.Date(2026, 10, 6, 2, 30, 0, 0, liveZone)
	nowFn = func() time.Time { return night }
	t.Cleanup(func() { nowFn = time.Now })
	bankCheck(t, f)
	setReadStop("fincom", "stopped from FinCom")
	t.Cleanup(func() { clearReadStop("test") })
	n0 := f.n("")
	for i := 0; i < 3; i++ {
		bankNightTurn()
		readAndUploadAll(t)
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("asked while reading is stopped from FinCom: %v", got)
	}
	clearReadStop("test")
	postTaking.Store(true)
	for i := 0; i < 3; i++ {
		bankNightTurn()
		readAndUploadAll(t)
	}
	postTaking.Store(false)
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("asked during a posting: %v", got)
	}
	// a stop in the middle: the list asked, then FinCom stops reading: the entry is not read until it is lifted
	bankNightTurn()
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("lists %d", n)
	}
	setReadStop("fincom", "stopped from FinCom")
	readAndUploadAll(t)
	if len(bankAsked(f)) != 0 {
		t.Fatalf("read while stopped: %v", bankAsked(f))
	}
	clearReadStop("test")
	for i := 0; i < 3; i++ {
		readAndUploadAll(t)
	}
	if a := bankAsked(f); fmt.Sprint(a) != fmt.Sprint(map[string]int{"26311": 1}) {
		t.Fatalf("Tally asked %v", a)
	}
	if s := bankSent(c); len(s["26311"]) != 1 {
		t.Fatalf("sent %v", s)
	}
	// the night's window over (07:00, office hours): a further bank date waits for the next night
	nowFn = func() time.Time { return time.Date(2026, 10, 6, 10, 0, 0, 0, liveZone) }
	bankSet(f, "26312", "20261008")
	bankCheck(t, f)
	bankNightTurn()
	readAndUploadAll(t)
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("listed by day for a nightly company: %d", n)
	}
}

// --- 6. renumbering and bank dates together: a receipt inserted before 191 (Tally renumbers 191 .. 194) and a bank date
// set on 193: each entry is read from Tally once (the bank route and renumbering share what was read), 193 goes to FinCom
// with its new number and its bank date
func TestBankDateNoDoubleReadWithRenumber(t *testing.T) {
	p, f, c := renumBridge(t, `,"BankGapMs":0`)
	f.mu.Lock()
	f.alter = 54394
	f.mu.Unlock()
	bankCheck(t, f) // the bank route starts at 54394
	bankSet(f, "26313", "20261009")
	renumInsert(f, 26400, "20261005", "191")
	f.mu.Lock()
	f.alter = 54400
	f.mu.Unlock()
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	readAndUploadAll(t)
	bankCheck(t, f)
	for i := 0; i < 6; i++ {
		readAndUploadAll(t)
	}
	if n := len(bankLists(f)); n != 1 {
		t.Fatalf("lists %d", n)
	}
	want := map[string]int{"26400": 1, "26311": 1, "26312": 1, "26313": 1, "26314": 1}
	if a := renumAsked(f); fmt.Sprint(a) != fmt.Sprint(want) {
		t.Fatalf("Tally asked %v, want %v (each entry once)", a, want)
	}
	var got []M
	for _, s := range c.recSent() {
		if str(s["master_id"]) == "26313" && str(s["event"]) == "altered" {
			got = append(got, s)
		}
	}
	if len(got) != 1 || str(got[0]["vch_no"]) != "194" || !strings.Contains(str(got[0]["xml"]), "20261009") {
		t.Fatalf("193 sent as %v (want one altered line, 194 now, with its bank date)", got)
	}
	if alt := renumAltered(c); len(alt["26311"]) != 1 || len(alt["26312"]) != 1 || len(alt["26314"]) != 1 {
		t.Fatalf("renumbered lines %v", alt)
	}
}

// --- 7. the 2 s rule with the 2.3.4 one-more-ask rule: an entry whose read stops at 2 s is asked once more, 5 minutes
// later (not before; another entry is not held back meanwhile); stopped again it is not asked a third time: said plainly
// (the log and the beat: upload the Day Book)
func TestBankDateOneMoreAsk(t *testing.T) {
	_, f, _ := bankBridge(t, `,"RecorderLimitMs":300,"RecorderStopCoolSec":0`)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID && strings.Contains(body, "ID:26311<") {
			return 800 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	bankSet(f, "26311", "20261007")
	bankSet(f, "26312", "20261008")
	bankCheck(t, f)
	readAndUploadAll(t)
	if a := bankAsked(f); a["26311"] != 1 {
		t.Fatalf("first turn: %v", a)
	}
	for i := 0; i < 4; i++ { // within the 5 minutes: 26311 not asked again; 26312 goes on
		retryReset()
		laterBy(t, time.Minute)
		readAndUploadAll(t)
	}
	if a := bankAsked(f); a["26311"] != 1 || a["26312"] != 1 {
		t.Fatalf("within 5 minutes: %v (want 26311 once, 26312 read)", a)
	}
	for i := 0; i < 6; i++ {
		retryReset()
		laterBy(t, 2*time.Minute)
		readAndUploadAll(t)
	}
	if a := bankAsked(f); a["26311"] != 2 {
		t.Fatalf("Tally asked %v (want 26311 twice: once, and once more)", a)
	}
	words := "1 bank date set in Tally may not have reached FinCom for " + nwsCo + "; upload the Day Book from 05-Oct-2026"
	if !strings.Contains(readText(logFile()), words) {
		t.Fatalf("the log does not say %q:\n%s", words, readText(logFile()))
	}
	if b := bankBeat(); len(b) != 1 || !strings.Contains(str(obj(b[0])["words"]), words) {
		t.Fatalf("the beat: %v", b)
	}
}

// --- 8. no request but the allow-list's three: FinComCompany, the undated TDSDeskKeepList above an AlterID, and
// FinComVoucherObject (besides the company lookup every background read makes to find the company's Tally: TDSDeskCompanies,
// and TDSDeskCompanyInfo once when a company is first seen)
func TestBankDateOnlyApprovedRequests(t *testing.T) {
	_, f, _ := bankBridge(t, "")
	n0 := f.n("")
	bankSet(f, "26311", "20261007")
	bankCheck(t, f)
	for i := 0; i < 3; i++ {
		readAndUploadAll(t)
	}
	f.mu.Lock()
	got, bodies := append([]string{}, f.reqs[n0:]...), append([]string{}, f.bodies[n0:]...)
	f.mu.Unlock()
	for i, id := range got {
		switch id {
		case "FinComCompany", "TDSDeskCompanies", "TDSDeskCompanyInfo":
		case "TDSDeskKeepList":
			if bodies[i] != keepListAboveRequest(nwsCo, 54392) {
				t.Fatalf("the list is not as built: %s", bodies[i])
			}
		case vchObjectID:
			if bodies[i] != voucherObjectRequest(nwsCo, "26311") {
				t.Fatalf("the entry request is not as built: %s", bodies[i])
			}
		default:
			t.Fatalf("request %s is not one of the bank route's", id)
		}
		if err := checkAllowed(bodies[i]); err != nil {
			t.Fatalf("not on the allow-list: %v", err)
		}
	}
}
