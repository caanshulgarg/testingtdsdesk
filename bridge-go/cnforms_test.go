package main

// Bridge 2.2.0, the owner's finding on NWS144 (04-Oct-2026): FinComCompany answered the company (name, GUID) with
// empty ALTVCHID / ALTMSTID, so no starting point was ever recorded. AltVchId and AltMstId are Company methods, not
// stored fields: a collection's FETCH does not give them. Form a asks them as NATIVEMETHODs; form b, a small report whose
// fields SET $AltVchId / $AltMstId. Written before the fix.

import (
	"strings"
	"testing"
	"time"
)

func cnSetup(t *testing.T, mode string) (*standTally, []M) {
	t.Helper()
	f := newStandTally(t)
	f.cnMode = mode
	standBridge(t, f, `,"CompanyCheckSec":2`)
	f.add(today(), fgParty, "CN-1", "one", "-1.00")
	f.add(today(), fgParty, "CN-2", "two", "-1.00")
	return f, openCompaniesWith(fin, true)
}

func TestChangeNumbersEmptyAnswer(t *testing.T) {
	f, sessions := cnSetup(t, "none")
	n0 := f.n("")
	lightCheckOpen(sessions)
	if _, ok := startPointOf(zz); ok {
		t.Fatal("a starting point recorded without numbers")
	}
	ids := f.ids()[n0:]
	if strings.Join(ids, ",") != "FinComCompany,"+cnReportID {
		t.Fatalf("asked: %v", ids)
	}
	if logLines("Company "+zz+": Tally gave no change numbers with form a or b (answer head: <ENVELOPE>") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
}

func TestChangeNumbersZeroNotRecorded(t *testing.T) {
	_, sessions := cnSetup(t, "zero")
	lightCheckOpen(sessions)
	if sp, ok := startPointOf(zz); ok {
		t.Fatalf("0 recorded as a starting point: %d", sp)
	}
}

func TestChangeNumbersNativeMethod(t *testing.T) {
	f, sessions := cnSetup(t, "native")
	n0 := f.n("")
	lightCheckOpen(sessions)
	if sp, ok := startPointOf(zz); !ok || sp != 2 {
		t.Fatalf("starting point: %d %v", sp, ok)
	}
	if f.n(cnReportID) != 0 || f.n("FinComCompany") != 1+countIn(f.ids()[:n0], "FinComCompany") {
		t.Fatalf("asked: %v", f.ids()[n0:])
	}
	if logLines("Company "+zz+": change numbers read with form a: ALTVCHID=2, ALTMSTID=") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	b := f.bodiesOf("FinComCompany")
	x := b[len(b)-1]
	if !strings.Contains(x, "<NATIVEMETHOD>AltVchId</NATIVEMETHOD><NATIVEMETHOD>AltMstId</NATIVEMETHOD>") || computedFigure(x) != "" {
		t.Fatalf("form a: %s", x)
	}
}

func TestChangeNumbersReportForm(t *testing.T) {
	f, sessions := cnSetup(t, "report")
	lightCheckOpen(sessions)
	if sp, ok := startPointOf(zz); !ok || sp != 2 {
		t.Fatalf("starting point: %d %v", sp, ok)
	}
	if logLines("Company "+zz+": change numbers read with form b: ALTVCHID=2, ALTMSTID=") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	// kept: form b from then on, one request
	f.mu.Lock()
	f.add(today(), fgParty, "CN-3", "three", "-1.00")
	f.mu.Unlock()
	n0 := f.n("")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	if ids := f.ids()[n0:]; strings.Join(ids, ",") != cnReportID {
		t.Fatalf("with form b kept: %v", ids)
	}
	if companyAlter(zz) != 3 {
		t.Fatalf("ALTVCHID: %d", companyAlter(zz))
	}
	x := f.bodiesOf(cnReportID)[0]
	for _, w := range []string{"<SET>$AltVchId</SET>", "<SET>$AltMstId</SET>", `$Name = &#34;` + zz + `&#34;`, "<TYPE>Data</TYPE>"} {
		if !strings.Contains(x, w) {
			t.Fatalf("form b lacks %q: %s", w, x)
		}
	}
	if m := computedFigure(x); m != "" {
		t.Fatalf("form b: a computed figure %q", m)
	}
	readDaysOff := datedRefused(fin, x) == nil && datedRefused(fin, companyCheckRequest(zz)) == nil
	if !readDaysOff {
		t.Fatal("a form is refused with ReadDays off")
	}
	if err := checkAllowed(x); err != nil {
		t.Fatal(err)
	}
}

// each form is bounded (CompanyCheckSec, 15 s by default) and never sent while an import is at Tally
func TestChangeNumbersBounded(t *testing.T) {
	f, sessions := cnSetup(t, "report")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == cnReportID {
			return 4 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	_, _ = companyCheck(fin, zz, f.port)
	if el := time.Since(t0); el > 3500*time.Millisecond {
		t.Fatalf("waited %s (limit 2 s here)", el)
	}
	importsInFlight.Add(1)
	n0 := f.n("")
	lightCheckOpen(sessions)
	importsInFlight.Add(-1)
	if f.n("") != n0 {
		t.Fatalf("asked during an import: %v", f.ids()[n0:])
	}
}

func countIn(a []string, s string) int {
	n := 0
	for _, x := range a {
		if x == s {
			n++
		}
	}
	return n
}
