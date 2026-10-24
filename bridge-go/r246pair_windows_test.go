package main

// 2.4.6 on Windows: the install's first-start ask in the install's record in the registry (pairstore_windows.go), on a
// key of the test's own under HKCU

import (
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestWindowsPairStoreRegistry(t *testing.T) {
	old := pairStoreKey
	pairStoreKey = `SOFTWARE\FinComTest246PairStore`
	t.Cleanup(func() { _ = registry.DeleteKey(registry.CURRENT_USER, pairStoreKey); pairStoreKey = old })
	st := regPairStore{registry.CURRENT_USER}
	if st.get(pairDueVal) != "" || st.del(pairDueVal) != nil {
		t.Fatal("an empty record")
	}
	notePairOpen(st, []string{"--pairopen"}, 0, func(s string) { t.Error(s) })
	if v := parseObj(st.get(pairDueVal)); num(v["atUnix"]) <= 0 || str(v["version"]) != BridgeVersion {
		t.Fatalf("the ask: %v", v)
	}
	if err := st.set(pairNowVal, "x"); err != nil || st.get(pairNowVal) != "x" {
		t.Fatalf("at once: %v", err)
	}
	clearPairOpen(st)
	if st.get(pairDueVal) != "" || st.get(pairNowVal) != "" {
		t.Fatal("not cleared")
	}
	notePairOpen(st, []string{"--mode", "sole"}, 0, func(s string) { t.Error(s) })
	if st.get(pairDueVal) != "" {
		t.Fatal("asked without --pairopen")
	}
}
