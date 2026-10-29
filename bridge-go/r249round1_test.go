package main

// 2.4.9 review round 1 (docs/reviews/bridge-2.4.9-{code,security}-review.md, range a9cbec7f8..86dc851b9): each finding's
// test, written before its fix

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// an entry of a Tally base type carrying employees' pay heads (a salary Journal filled by Payroll Auto Fill): the
// payroll learning never learns a base type, so it is not kept out of a group by its type
const r1PayHeads = `<CATEGORYENTRY.LIST><CATEGORY>Primary Cost Category</CATEGORY><EMPLOYEEENTRIES.LIST><EMPLOYEENAME>E One</EMPLOYEENAME>` +
	`<AMOUNT>-5000.00</AMOUNT><PAYHEADALLOCATIONS.LIST><PAYHEADNAME>Basic Pay</PAYHEADNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` +
	`<AMOUNT>-5000.00</AMOUNT></PAYHEADALLOCATIONS.LIST></EMPLOYEEENTRIES.LIST></CATEGORYENTRY.LIST>`

const r1PayJournal = `<VOUCHER REMOTEID="g-77" VCHTYPE="Journal"><DATE>20250915</DATE><GUID>g-77</GUID><MASTERID>77</MASTERID><ALTERID> 77</ALTERID>` +
	`<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>77</VOUCHERNUMBER><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED>` +
	`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Salary Payable</LEDGERNAME><AMOUNT>5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>` + r1PayHeads + `</VOUCHER>`

// R1-1 / S-1 (High): an entry whose pay heads FinComVoucherObject's strip would write (or hold on) is never taken from a
// group: CATEGORYENTRY dropped would send it short
func TestR249R1PayHeadsOfABaseTypeNotTakenFromAGroup(t *testing.T) {
	liveBridge(t, "") // the bridge's folders (and its log) in a temporary place: payroll learning may write a line
	full, why := fastStripWhy(r1PayJournal)
	if why != "" || !strings.Contains(full, "Basic Pay") {
		t.Fatalf("the precondition: FinComVoucherObject's strip writes the pay head (why %q): %s", why, cut(full, 600))
	}
	if payrollEntry("R1 CO", "Journal") {
		t.Fatal("a base type learned as payroll")
	}
	if v, leave := batchEntry("R1 CO", r1PayJournal); leave == "" {
		t.Fatalf("taken from the group as %s", cut(v, 600))
	}
	// an entry without pay heads still comes from the group
	plain := strings.Replace(r1PayJournal, r1PayHeads, "", 1)
	if _, leave := batchEntry("R1 CO", plain); leave != "" {
		t.Fatalf("an entry without pay heads left: %s", leave)
	}
	// in the period fetch: the day's group; that entry read one by one, FinCom gets FinComVoucherObject's answer
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 3000, "Journal", "Sales", "Sales", "Sales")
	f.mu.Lock()
	vs[0].extra = r1PayHeads
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 1 {
		t.Fatalf("groups %d, one by one %d", len(batchBodies(f)), f.n(vchObjectID))
	}
	got := sentEntries(m)
	if len(got) != 4 || !strings.Contains(got["3000"], "Basic Pay") {
		t.Fatalf("%d sent; the pay-head entry as %s", len(got), cut(got["3000"], 600))
	}
	pull.mu.Lock()
	asked := toInt(pull.state[companyKey(zz)]["asked"])
	pull.mu.Unlock()
	// R1-7: an entry a group left is counted once (when FinComVoucherObject reads it)
	if asked != 4 {
		t.Fatalf("asked %d (want 4)", asked)
	}
}

// R1-2 / S-2 (High): a group stopped at 2 s: Tally's window is watched until Tally finishes it, and a hold of 2 s by
// then stops the company's period (it does not halve)
func TestR249R1WindowWatchedAfterAStop(t *testing.T) {
	f, c, _ := pullBridgeWith(t, `,"TallyAbandonMaxSec":600`) // as shipped: a request given up is held until Tally ends it
	stops := r1Stops(c)
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales", "Sales", "Sales")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			return 3 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	old := windowHoldFn
	var mu sync.Mutex
	n := 0
	windowHoldFn = func() func(time.Time) int {
		mu.Lock()
		n++
		first := n == 1
		mu.Unlock()
		t0 := time.Now()
		return func(time.Time) int {
			if first {
				return 0 // the day's list
			}
			// the window stops answering 0.4 s into the group and is still held when Tally ends it at 3 s
			if d := time.Since(t0); d > 400*time.Millisecond {
				return int((d - 400*time.Millisecond) / time.Millisecond)
			}
			return 0
		}
	}
	t.Cleanup(func() { windowHoldFn = old })
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 10)
	if len(batchBodies(f)) != 1 || len(*stops) != 1 || str((*stops)[0]["why"]) != "window" {
		t.Fatalf("groups %d, stops %v", len(batchBodies(f)), *stops)
	}
}

// R1-2: Tally not done with the stopped group within TallyAbandonWaitSec: the company's period stops (over2s)
func TestR249R1StoppedGroupNotFinishedStopsCompany(t *testing.T) {
	f, c, _ := pullBridgeWith(t, `,"TallyAbandonWaitSec":1,"TallyAbandonMaxSec":600`)
	stops := r1Stops(c)
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales", "Sales", "Sales")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			return 4 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 10)
	if len(batchBodies(f)) != 1 || len(*stops) != 1 || str((*stops)[0]["why"]) != "over2s" {
		t.Fatalf("groups %d, stops %v", len(batchBodies(f)), *stops)
	} // Tally ends the group 2 s after the bound: its line is written while this test's folders are still there
	for end := time.Now().Add(10 * time.Second); earlierBusyAny() && time.Now().Before(end); {
		time.Sleep(50 * time.Millisecond)
	}
}

func r1Stops(c *standCloud) *[]M {
	var stops []M
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "period_stop" {
			stops = append(stops, b)
			return 200, M{"ok": true}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	return &stops
}

// R1-3 (Medium): a group of large entries reaches FinCom in bodies of at most 4 MB (one entry over at most) and at most
// DayPullBatch entries
func TestR249R1UploadBodiesStaySmall(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	types := make([]string, 100)
	for i := range types {
		types[i] = "Sales"
	}
	vs := pullDay(f, "20250915", 1000, types...)
	big := strings.Repeat("x", 100<<10)
	f.mu.Lock()
	for _, v := range vs {
		v.narr = big
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 60)
	if len(batchBodies(f)) != 1 {
		t.Fatalf("groups %d", len(batchBodies(f)))
	}
	total := 0
	for _, e := range m.entries {
		n, bytes := 0, 0
		for _, x := range arr(e["vouchers"]) {
			n++
			bytes += len(str(x))
		}
		if n > pullFlushAt() || bytes > 4<<20+110<<10 {
			t.Fatalf("a body of %d entries, %d bytes", n, bytes)
		}
		total += n
	}
	if total != 100 || len(m.entries) < 3 {
		t.Fatalf("%d entries in %d bodies", total, len(m.entries))
	}
}

// R1-4 (Medium): the group size a company's slow day came down to carries to its next days (a run of the bridge): a
// day whose 100 stopped and 50 went: the next day starts at 50; a day that went one by one: the next day one by one
func TestR249R1SlowSizeCarriesToTheNextDay(t *testing.T) {
	f, c, m := pullBridgeWith(t, "")
	stops := r1Stops(c)
	n := 120
	types := make([]string, n)
	for i := range types {
		types[i] = "Sales"
	}
	a := pullDay(f, "20250915", 1000, types...)
	b := pullDay(f, "20250916", 2000, types...)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			if r := reBatchRange.FindStringSubmatch(body); r != nil && toI64(r[2])-toI64(r[1])+1 > 50 {
				return 2300 * time.Millisecond
			}
		}
		return 0
	}
	f.mu.Unlock()
	r1RunDays(t, m, len(a)+len(b), "20250915", "20250916")
	var sizes []int64
	for _, x := range batchBodies(f) {
		if r := reBatchRange.FindStringSubmatch(x); r != nil {
			sizes = append(sizes, toI64(r[2])-toI64(r[1])+1)
		}
	}
	// day 1: 100 (stopped), then 50, 50, 20; day 2: 50, 50, 20: one group of 100 in all
	if fmt.Sprint(sizes) != "[100 50 50 20 50 50 20]" || len(*stops) != 0 {
		t.Fatalf("groups %v, stops %v", sizes, *stops)
	}
}

func TestR249R1OneByOneCarriesToTheNextDay(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	types := make([]string, 120)
	for i := range types {
		types[i] = "Sales"
	}
	a := pullDay(f, "20250915", 1000, types...)
	b := pullDay(f, "20250916", 2000, types[:10]...)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			return 2300 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	r1RunDays(t, m, len(a)+len(b), "20250915", "20250916")
	if len(batchBodies(f)) != 2 || f.n(vchObjectID) != len(a)+len(b) {
		t.Fatalf("groups %d (want the first day's 100 and 50 only), one by one %d", len(batchBodies(f)), f.n(vchObjectID))
	}
}

func r1RunDays(t *testing.T, m *pullModel, want int, days ...string) {
	t.Helper()
	at := nowFn()
	applyPeriodDays(pullList(days...))
	for i := 0; i < 80 && len(m.held) < want; i++ { // the shared retry schedule waits after a stop: time moves on
		pullRun(t, 300)
		at = at.Add(time.Minute)
		nowFn = func() time.Time { return at }
		applyPeriodDays(pullList(days...))
	}
	if len(m.held) < want {
		t.Fatalf("FinCom holds %d of %d", len(m.held), want)
	}
}

// R1-5 (Medium): a day's groups go straight after its heads: heads older than DayPullHeadsFreshSec (60 s) when a group is
// due (FinCom slow to answer the heads) are asked of Tally again first
func TestR249R1StaleHeadsAskedAgain(t *testing.T) {
	f, c, m := pullBridgeWith(t, "")
	pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales", "Sales")
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if k == "period_heads" && !truthy(b["upload"]) {
			at := nowFn().Add(2 * time.Minute) // FinCom took two minutes
			nowFn = func() time.Time { return at }
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	ids := f.ids()
	last := strings.LastIndex(strings.Join(ids, ","), dayHeadsID)
	first := strings.Index(strings.Join(ids, ","), vchBatchID)
	if f.n(dayHeadsID) != 2 || len(batchBodies(f)) != 1 || len(m.heads) != 1 || last > first {
		t.Fatalf("heads %d, groups %d, heads to FinCom %d: %v", f.n(dayHeadsID), len(batchBodies(f)), len(m.heads), ids)
	}
	if len(sentEntries(m)) != 4 {
		t.Fatalf("%d sent", len(sentEntries(m)))
	}
}

// R1-7 (Medium): an entry whose GUID is no longer the one the day's list named: not sent, out of the wanted list, the
// day ends (never asked again in a later group)
func TestR249R1GUIDChangedNotSentDayEnds(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales")
	var once sync.Once
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			once.Do(func() { vs[1].guid = vs[1].guid + "-new" })
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	got := sentEntries(m)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 0 || len(got) != 2 || got[vs[1].master] != "" || pullCurrent() != nil {
		t.Fatalf("groups %d, one by one %d, sent %d, day still read %v", len(batchBodies(f)), f.n(vchObjectID), len(got), pullCurrent() != nil)
	}
}

// R1-9 (Low): the item rule looks inside each ALLINVENTORYENTRIES list only: an empty item list, then a stock item under
// a ledger line's inventory allocations (an accounting invoice), keeps the entry's ALLLEDGERENTRIES
func TestR249R1ItemRuleInsideItsList(t *testing.T) {
	v := `<VOUCHER><GUID>g</GUID><ALLINVENTORYENTRIES.LIST>     </ALLINVENTORYENTRIES.LIST>` +
		`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100</AMOUNT><INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Pen</STOCKITEMNAME></INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>` +
		`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-100</AMOUNT></ALLLEDGERENTRIES.LIST>` +
		`<LEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-100</AMOUNT></LEDGERENTRIES.LIST></VOUCHER>`
	got := batchConvert(v)
	if !strings.Contains(got, "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales") || strings.Contains(got, "<LEDGERENTRIES.LIST>") {
		t.Fatalf("converted as an item invoice: %s", got)
	}
	item := strings.Replace(v, `<ALLINVENTORYENTRIES.LIST>     </ALLINVENTORYENTRIES.LIST>`, `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Pen</STOCKITEMNAME></ALLINVENTORYENTRIES.LIST>`, 1)
	if got := batchConvert(item); strings.Contains(got, "<ALLLEDGERENTRIES.LIST>") || !strings.Contains(got, "<LEDGERENTRIES.LIST>") {
		t.Fatalf("an item invoice: %s", got)
	}
}

// R1-10 / S-3 (Low): the dated guard lets the group through only under the period fetch's own stop (a copier's
// background request, not a person's)
func TestR249R1GuardWantsTheCopiersStop(t *testing.T) {
	liveBridge(t, "")
	pullReset()
	t.Cleanup(pullReset)
	noteStartPoint("ZZ CO", "guid-zz", 1, 1)
	x := voucherBatchRangeRequest("ZZ CO", "20260831", 100, 199)
	pull.mu.Lock()
	pull.batchAsk = x
	pull.mu.Unlock()
	if datedRefused(recorderTC(nil), x) != nil {
		t.Fatal("the period fetch's own request refused")
	}
	notCopier := recorderTC(nil)
	notCopier.copier = false
	person := recorderTC(nil)
	person.person = true
	for _, tc := range []*TC{notCopier, person} {
		if datedRefused(tc, x) == nil {
			t.Fatalf("went without the copier's stop: %+v", tc)
		}
	}
}

// R1-11 / S-5 (Low): the FETCH is the approved text, frozen: a change of FinComVoucherObject's fields never widens
// FinComVoucherBatch (the request is then not built: one by one)
func TestR249R1FetchFrozen(t *testing.T) {
	s := sha256.Sum256([]byte(batchFetchText))
	if hex.EncodeToString(s[:]) != batchFetchSHA {
		t.Fatalf("the FETCH changed: %s", hex.EncodeToString(s[:]))
	}
	old := batchFetchText
	t.Cleanup(func() { batchFetchText = old })
	batchFetchText = old + ", ADDRESS"
	if voucherBatchRangeRequest("ZZ CO", "20260831", 1, 2) != "" || voucherBatchListRequest("ZZ CO", "20260831", []string{"1", "3"}) != "" {
		t.Fatal("built with another FETCH")
	}
}

// R1-6 (Medium): the gate's field-by-field comparison (tally-versions mode bdiff, run 40815068422) kept in the
// repository: every entry of every group answer on TallyPrime 7.1 and 3.0 (tdsgst, TDS challan payments, payroll with
// salary payments per employee, stock journals) goes through the bridge's own per-entry steps (batchEntry): it is left
// for FinComVoucherObject, or it is exactly FinComVoucherObject's answer through its strip (a REMOTEID equal to the GUID
// aside)
func TestR249R1GateAnswersAsObject(t *testing.T) {
	liveBridge(t, "") // the bridge's folders (and its log) in a temporary place: payroll learning may write a line
	reRemote := regexp.MustCompile(` REMOTEID="[^"]*"`)
	for _, rel := range []string{"7.1", "3.0"} {
		zr, err := zip.OpenReader(filepath.Join("testdata", "batch249", "gate-"+rel+".zip"))
		if err != nil {
			t.Fatal(err)
		}
		files := map[string]string{}
		for _, f := range zr.File {
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(rc)
			rc.Close()
			files[filepath.Base(f.Name)] = textFromBytes(b)
		}
		zr.Close()
		var plan []struct {
			File string   `json:"file"`
			Mids []string `json:"mids"`
		}
		if err := json.Unmarshal([]byte(files["diff-plan.json"]), &plan); err != nil || len(plan) < 30 {
			t.Fatalf("%s: the plan (%v)", rel, err)
		}
		same, left := 0, 0
		types := map[string]bool{}
		for _, w := range plan {
			got := map[string]string{}
			for _, b := range reVchBlock.FindAllString(reCmpInfo.ReplaceAllString(files[w.File], ""), -1) {
				c := cleanXML(b)
				got[strings.TrimLeft(tagNum(c, "MASTERID"), "0")] = c
			}
			for _, mid := range w.Mids {
				c, ok := got[mid]
				if !ok {
					t.Fatalf("%s %s: MasterID %s not answered", rel, w.File, mid)
				}
				types[tagValue(c, "VOUCHERTYPENAME")] = true
				v, leave := batchEntry("GATE "+rel, c)
				if leave != "" {
					left++
					if !strings.Contains(leave, "type of supply") {
						t.Logf("%s MasterID %s (%s) left: %s", rel, mid, tagValue(c, "VOUCHERTYPENAME"), leave)
					}
					continue
				}
				var want string
				for _, ov := range reVchBlock.FindAllString(files["obj-"+mid+".xml"], -1) {
					want, _ = fastStripWhy(cleanXML(ov))
				}
				if want == "" {
					t.Fatalf("%s MasterID %s: no object answer", rel, mid)
				}
				if reRemote.ReplaceAllString(v, "") != reRemote.ReplaceAllString(want, "") {
					t.Errorf("%s %s MasterID %s (%s) differs:\nbatch  %s\nobject %s", rel, w.File, mid, tagValue(c, "VOUCHERTYPENAME"), cut(v, 2000), cut(want, 2000))
				}
				same++
			}
		}
		for _, ty := range []string{"Stock Journal", "Payment", "Journal", "Sales", "Purchase"} {
			if !types[ty] {
				t.Errorf("%s: no %s entry in the gate's answers", rel, ty)
			}
		}
		t.Logf("%s: %d identical, %d left for FinComVoucherObject", rel, same, left)
		if same < 70 {
			t.Fatalf("%s: %d identical", rel, same)
		}
	}
}

// R1-6: an entry gone from the day between its heads and its group (deleted, or moved to another day): the answer is not
// exactly the entries asked; nothing of it is used, the day goes one by one, and the entry gone is not sent
func TestR249R1EntryGoneBeforeTheGroup(t *testing.T) {
	f, _, m := pullBridgeWith(t, "")
	vs := pullDay(f, "20250915", 1000, "Sales", "Sales", "Sales")
	var once sync.Once
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchBatchID {
			once.Do(func() { vs[1].date = "20250916" })
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	got := sentEntries(m)
	if len(batchBodies(f)) != 1 || f.n(vchObjectID) != 3 || len(got) != 2 || got[vs[1].master] != "" {
		t.Fatalf("groups %d, one by one %d, sent %d", len(batchBodies(f)), f.n(vchObjectID), len(got))
	}
}
