// FinCom Bridge 2.5.12 (range2512.go): the day lists of a range of days in one FinComDayHeads, for sparse books. No missing
// days (every listed day reported, empty ones too; a row outside the range never dropped; a range answer cut, in error,
// or not adding up never used; only days FinCom handed this bridge, consecutive ones together) and no hang of Tally
// (over 2 s stops the company as for one day; halved over 1 s; 31 days at most; single days after a large day).
package main

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// the FinComDayHeads requests the stand Tally got, as (from, to)
func r2512HeadsAsked(f *standTally) [][2]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o [][2]string
	for i, id := range f.reqs {
		if id == dayHeadsID {
			a, z := pinDates(f.bodies[i])
			o = append(o, [2]string{a, z})
		}
	}
	return o
}

// the days told to FinCom (period_heads, not an upload mark), each with its count
func r2512Told(m *pullModel) map[string]int {
	o := map[string]int{}
	for _, b := range m.heads {
		if !truthy(b["upload"]) {
			o[str(b["day"])] = toInt(b["n"])
		}
	}
	return o
}

// a sparse stretch: 7 listed days, entries on two of them
func r2512Sparse(t *testing.T, mode string) (*standTally, *standCloud, *pullModel, []string, []*tVch) {
	t.Helper()
	f, c, m := pullBridgeWith(t, mode)
	days := []string{"20250901", "20250902", "20250903", "20250904", "20250905", "20250906", "20250907"}
	vs := append(pullDay(f, days[0], 700, "Sales", "Receipt"), pullDay(f, days[3], 710, "Payment")...)
	pullDay(f, "20250908", 720, "Journal") // a day Tally has that FinCom did not hand out
	return f, c, m, days, vs
}

// 1. every day of the range is reported, the empty ones as empty lists, in ONE request for the lists; only the days
// FinCom handed out; the entries asked per day as before
func TestR2512RangeEveryDayReported(t *testing.T) {
	f, _, m, days, vs := r2512Sparse(t, "")
	applyPeriodDays(M{"periodDays": pullList(days...)["periodDays"], "periodNight": true})
	pullRun(t, 80)
	if got := r2512HeadsAsked(f); len(got) != 1 || got[0] != [2]string{days[0], days[6]} {
		t.Fatalf("lists asked: %v", got)
	}
	told := r2512Told(m)
	want := map[string]int{days[0]: 2, days[1]: 0, days[2]: 0, days[3]: 1, days[4]: 0, days[5]: 0, days[6]: 0}
	if fmt.Sprint(told) != fmt.Sprint(want) {
		t.Fatalf("told %v, want %v", told, want)
	}
	if len(m.upload) != 0 || len(sentEntries(m)) != len(vs) {
		t.Fatalf("upload %v, entries %d", m.upload, len(sentEntries(m)))
	}
	if pullCurrent() != nil {
		t.Fatal("a day still read")
	}
}

// 2. days FinCom handed out that are not next to each other are never in one range; one listed day alone is asked alone
func TestR2512RangeOnlyConsecutiveDays(t *testing.T) {
	f, _, m, days, _ := r2512Sparse(t, "")
	list := []string{days[0], days[1], days[3], days[4], days[6]}
	applyPeriodDays(M{"periodDays": pullList(list...)["periodDays"], "periodNight": true})
	pullRun(t, 80)
	got := r2512HeadsAsked(f)
	if fmt.Sprint(got) != fmt.Sprint([][2]string{{days[0], days[1]}, {days[3], days[4]}, {days[6], days[6]}}) {
		t.Fatalf("lists asked: %v", got)
	}
	told := r2512Told(m)
	if len(told) != 5 || told[days[0]] != 2 || told[days[3]] != 1 {
		t.Fatalf("told %v", told)
	}
	if _, had := told[days[2]]; had {
		t.Fatal("a day FinCom did not hand out was told")
	}
}

// 3. a range answer with a row dated outside it, cut, or a Tally error: nothing of it used; each day asked alone and
// reported as it is (the row outside the range never dropped silently: its own day is read in its own turn)
func TestR2512RangeAnswerNotUsedWhenInDoubt(t *testing.T) {
	for name, answer := range map[string]string{
		"outside": `<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER REMOTEID="x" VCHTYPE="Sales"><DATE TYPE="Date">20250908</DATE><GUID>x</GUID><ALTERID> 9</ALTERID><MASTERID> 999</MASTERID></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>`,
		"cut":     `<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER REMOTEID="x" VCHTYPE="Sales"><DATE TYPE="Date">20250901</DATE>`,
		"error":   `<ENVELOPE><BODY><DATA><LINEERROR>Could not set 'SVCurrentCompany'</LINEERROR></DATA></BODY></ENVELOPE>`,
	} {
		t.Run(name, func(t *testing.T) {
			f, _, m, days, vs := r2512Sparse(t, "")
			f.mu.Lock()
			f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
				if a, z := pinDates(body); id == dayHeadsID && z > a {
					fmt.Fprint(w, answer)
					return true
				}
				return false
			}
			f.mu.Unlock()
			applyPeriodDays(M{"periodDays": pullList(days[:3]...)["periodDays"], "periodNight": true})
			pullRun(t, 80)
			got := r2512HeadsAsked(f)
			if len(got) != 4 || got[0] != [2]string{days[0], days[2]} {
				t.Fatalf("lists asked: %v", got)
			}
			for i, d := range days[:3] {
				if got[i+1] != [2]string{d, d} {
					t.Fatalf("not asked alone: %v", got)
				}
			}
			told := r2512Told(m)
			if fmt.Sprint(told) != fmt.Sprint(map[string]int{days[0]: 2, days[1]: 0, days[2]: 0}) || len(m.upload) != 0 {
				t.Fatalf("told %v, upload %v", told, m.upload)
			}
			if sent := sentEntries(m); len(sent) != 2 || sent[vs[0].master] == "" || sent[vs[1].master] == "" {
				t.Fatalf("entries %d", len(sent))
			}
			// the company's later ranges are single days
			if n := pullRangeN(pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}); n != 1 {
				t.Fatalf("range size after a doubtful answer: %d", n)
			}
		})
	}
}

// 4. a range over the 2 s stop: the company's period stops exactly as for one day's list; no day of the range is told
// or marked done, and the same range is never asked again
func TestR2512RangeOver2sStopsAsADay(t *testing.T) {
	f, c, m, days, _ := r2512Sparse(t, "")
	stops := r1Stops(c)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(M{"periodDays": pullList(days...)["periodDays"], "periodNight": true})
	pullRun(t, 40)
	if got := r2512HeadsAsked(f); len(got) != 1 {
		t.Fatalf("lists asked: %v", got)
	}
	if len(r2512Told(m)) != 0 || len(m.entries) != 0 || len(*stops) != 1 || str((*stops)[0]["why"]) != "over2s" {
		t.Fatalf("told %v, entries %d, stops %v", r2512Told(m), len(m.entries), *stops)
	}
	applyPeriodDays(M{"periodDays": pullList(days...)["periodDays"], "periodNight": true})
	pullRun(t, 40)
	if got := r2512HeadsAsked(f); len(got) != 1 {
		t.Fatalf("asked again after the stop: %v", got)
	}
}

// 5. the size: 7 days at the start of a period, doubled only after an answer under 1 s, halved after one over 1 s,
// never above 31 days; single days after a day of more than 200 entries
func TestR2512RangeHalvingAndCap(t *testing.T) {
	for _, c := range [][3]int{{7, 300, 14}, {14, 300, 28}, {28, 300, 31}, {31, 300, 31}, {7, 1000, 7}, {14, 1500, 7}, {7, 1500, 3}, {3, 1500, 1}, {1, 1500, 1}} {
		if got := pullRangeNext(c[0], c[1]); got != c[2] {
			t.Fatalf("after %d days in %d ms: %d, want %d", c[0], c[1], got, c[2])
		}
	}
	if dayHeadsRangeRequest("ZZ", "20250901", "20251001") == "" || dayHeadsRangeRequest("ZZ", "20250901", "20251002") != "" { // 31 days at most
		t.Fatal("a range of more than 31 days was built")
	}
	if dayHeadsRangeRequest("ZZ", "20250901", "20250930") == "" || dayHeadsRangeRequest("ZZ", "20250902", "20250901") != "" {
		t.Fatal("the range bounds")
	}
	// a slow answer (1.2 s) halves the next range
	f, _, _, days, _ := r2512Sparse(t, "")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if a, z := pinDates(body); id == dayHeadsID && z > a {
			return 1200 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	applyPeriodDays(M{"periodDays": pullList(days...)["periodDays"], "periodNight": true})
	pullRun(t, 80)
	it := pullItem{Company: zz, CGUID: b220CoGUID, Day: days[0], Fetch: true}
	if n := pullRangeN(it); n != 3 {
		t.Fatalf("after a 1.2 s answer: %d days", n)
	}
	// a day of more than 200 entries: single days from then on
	f2, _, m2 := pullBridgeWith(t, "")
	var types []string
	for i := 0; i < 201; i++ {
		types = append(types, "Sales")
	}
	pullDay(f2, "20250801", 5000, types...)
	applyPeriodDays(M{"periodDays": pullList("20250801", "20250802")["periodDays"], "periodNight": true})
	pullRun(t, 200)
	it.Day = "20250801"
	if n := pullRangeN(it); n != 1 || r2512Told(m2)["20250801"] != 201 {
		t.Fatalf("after a large day: %d, told %v", n, r2512Told(m2))
	}
}

// 6. the dated guard: the range form only as built, while it is being asked, every day of it listed now
func TestR2512RangeGuard(t *testing.T) {
	_, _, _, days, _ := r2512Sparse(t, "")
	applyPeriodDays(pullList(days[0], days[1]))
	x := dayHeadsRangeRequest(zz, days[0], days[1])
	tc := recorderTC(nil)
	if dayHeadsExact(tc, x) {
		t.Fatal("let through while not being asked")
	}
	pull.mu.Lock()
	pull.rangeAsk = x
	pull.mu.Unlock()
	if !dayHeadsExact(tc, x) {
		t.Fatal("refused while asked")
	}
	y := dayHeadsRangeRequest(zz, days[0], days[2])
	pull.mu.Lock()
	pull.rangeAsk = y
	pull.mu.Unlock()
	if dayHeadsExact(tc, y) {
		t.Fatal("a day not listed let through")
	}
	pull.mu.Lock()
	pull.rangeAsk = ""
	pull.mu.Unlock()
}
