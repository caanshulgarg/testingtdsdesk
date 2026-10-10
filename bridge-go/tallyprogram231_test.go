package main

// Bridge 2.3.1 (the version tests, run 37418469212): TallyPrime 7.1 also runs tallyscheduler.exe from its install folder;
// tallyProgram took the first program whose name starts with "tally", so on 7.1 it could name the scheduler (and keep
// the date settings under it). It now takes exactly tally.exe, failing that a name matching ^tally(prime)?\.exe$, never
// tallyscheduler or another helper. No request added or changed. Test written before the code.

import "testing"

func TestTallyProgramPrefersTallyExe(t *testing.T) {
	dir := `C:\Program Files\TallyPrime\`
	ps := []proc{{ID: 1, Name: "tallyscheduler", Path: dir + "tallyscheduler.exe"}, {ID: 2, Name: "tally", Path: dir + "tally.exe"}}
	if p, ok := pickTallyProgram(ps); !ok || p.ID != 2 {
		t.Fatalf("picked %+v %v, want tally.exe", p, ok)
	}
	// no tally.exe: TallyPrime.exe; a helper alone: none
	ps = []proc{{ID: 1, Name: "tallyscheduler", Path: dir + "tallyscheduler.exe"}, {ID: 3, Name: "TallyPrime", Path: dir + "TallyPrime.exe"}}
	if p, ok := pickTallyProgram(ps); !ok || p.ID != 3 {
		t.Fatalf("picked %+v %v, want TallyPrime.exe", p, ok)
	}
	for _, helper := range []string{"tallyscheduler", "TallyGateway", "tallyprime-helper", "tally32"} {
		if p, ok := pickTallyProgram([]proc{{ID: 4, Name: helper, Path: dir + helper + ".exe"}}); ok {
			t.Fatalf("a helper picked: %+v", p)
		}
	}
	// tally.exe wins over TallyPrime.exe whatever the order
	ps = []proc{{ID: 3, Name: "TallyPrime", Path: dir + "TallyPrime.exe"}, {ID: 2, Name: "Tally", Path: dir + "Tally.exe"}}
	if p, _ := pickTallyProgram(ps); p.ID != 2 {
		t.Fatalf("picked %+v, want tally.exe", p)
	}
}

// review L2 (06-Oct-2026): the Tally process filter everywhere else (ports, sessions, the Windows helpers) takes the same
// programs as tallyProgram: tally / TallyPrime, never tallyscheduler or another helper
func TestReTallyExcludesHelpers(t *testing.T) {
	for _, n := range []string{"tally", "Tally", "tally.exe", "TALLY.EXE", "TallyPrime", "tallyprime.exe"} {
		if !reTally.MatchString(n) {
			t.Fatalf("%q is not taken as Tally", n)
		}
	}
	for _, n := range []string{"tallyscheduler", "tallyscheduler.exe", "TallyGateway", "tally32", "tallyprime-helper", "TallyPrimeEditLog"} {
		if reTally.MatchString(n) {
			t.Fatalf("%q is taken as Tally", n)
		}
	}
}
