package main

import "testing"

// 2.5.10, the first version with a two-digit last part: the self-update compares it as numbers
func TestR2510Versions(t *testing.T) {
	for _, c := range [][3]string{{"2.5.10", "2.5.9", "1"}, {"2.5.9", "2.5.10", ""}, {"2.5.10", "2.5.10", ""}, {"2.6.0", "2.5.10", "1"}, {"2.5.11", "2.5.10", "1"}} {
		if newerVersion(c[0], c[1]) != (c[2] == "1") {
			t.Fatal(c)
		}
	}
	if !newerVersion(BridgeVersion, "2.5.9") {
		t.Fatalf("%s is not newer than 2.5.9", BridgeVersion)
	}
}
