package main

// The update list FinCom hands out with the bridge (assets-test/bridge-go/latest.json, shipped to the review site with
// FINCOM_SHIP_BRIDGE=1) must carry FinCom's signature (latest.json.sig) that this program's own key accepts: without
// it no bridge ever updates by itself ("The list of updates has no signature"). The release scripts sign it
// (tools/bridge_list_sign.py); this checks the kept signature with the bridge's real verifySigned and built-in key, and
// that a changed list is refused.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShippedListSignedWithBuiltInKey(t *testing.T) {
	t.Setenv("FINCOM_TEST_PUBKEY", "") // the built-in key (updatePublicKeyXML), never a test key
	dir := filepath.Join("..", "assets-test", "bridge-go")
	body, err := os.ReadFile(filepath.Join(dir, "latest.json"))
	if err != nil {
		t.Skip("no update list kept: " + err.Error())
	}
	sig, err := os.ReadFile(filepath.Join(dir, "latest.json.sig"))
	if err != nil {
		t.Fatalf("assets-test/bridge-go/latest.json has no latest.json.sig: no bridge would take it (sign it: tools/bridge_list_sign.py sign assets-test/bridge-go)")
	}
	if err := verifySigned(body, string(sig)); err != nil {
		t.Fatalf("latest.json.sig does not verify with the bridge's built-in key: %v (sign it again: tools/bridge_list_sign.py sign assets-test/bridge-go)", err)
	}
	changed := append([]byte{}, body...)
	changed[len(changed)/2] ^= 1
	if verifySigned(changed, string(sig)) == nil {
		t.Fatal("a changed list verified with the same signature")
	}
	if verifySigned(append(append([]byte{}, body...), '\n'), string(sig)) == nil {
		t.Fatal("a list with one more byte verified with the same signature")
	}
	// what checkForUpdate reads from it: the bridge part with a version, an https address and a SHA-256
	b := obj(parseObj(string(body))["bridge"])
	if str(b["version"]) == "" || len(str(b["sha256"])) != 64 || !strings.HasPrefix(str(b["url"]), "https://") {
		t.Fatalf("the list's bridge part is not what the updater reads: %v", b)
	}
}
