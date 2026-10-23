// Security-review hardening (2.1.5): the tray's routes, the Import fast path of the allow-list, company folder names.
package main

import (
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// a request to the bridge's web server as the tray (no Origin) or as a web page (origin given)
func callLocal(t *testing.T, method, path, origin, body string) (int, M) {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:9100"+path, strings.NewReader(body))
	r.Header.Set("X-Bridge-Key", cfgS("Key"))
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	handle(w, r)
	return w.Code, parseObj(w.Body.String())
}

// the tray's Resume reading clears a stop the bridge made itself, never one made from FinCom (that is lifted in FinCom)
func TestTrayResumeKeepsFinComStop(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	setReadStop("fincom", "the owner stopped reading in FinCom")
	code, res := callLocal(t, "POST", "/tray/resume-reading", "", "{}")
	if code != 200 {
		t.Fatalf("resume-reading: %d %v", code, res)
	}
	if st := readStop(); st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("the tray cleared a stop made from FinCom: %v", st)
	}
	if _, err := trayResumeReading(); err != nil {
		t.Fatal(err)
	}
	if st := readStop(); st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("trayResumeReading cleared a stop made from FinCom: %v", st)
	}
	// FinCom lifts its own stop
	clearReadStop("fincom-lifted")
	// 2.3.1: no stop by the bridge itself any more (never a manual resume): the tray's Resume reading has nothing to do
	if code, res := callLocal(t, "POST", "/tray/resume-reading", "", "{}"); code != 200 || res["resumed"] != false {
		t.Fatalf("resume-reading: %d %v", code, res)
	}
	if st := readStop(); st != nil {
		t.Fatalf("a stop: %v", st)
	}
}

// the tray's routes are for the tray (a program on this computer, no Origin), never for a web page, even FinCom's own
func TestTrayRoutesRefuseBrowserOrigin(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	setReadStop("fincom", "Stopped by the owner from FinCom")
	for _, origin := range []string{"https://app.fincom.live", "http://localhost:5173", "https://evil.example"} {
		for _, p := range []string{"/tray/pause", "/tray/resume-reading", "/tray/restart", "/tray/update", "/tray/idle", "/tray/quit", "/tray/check",
			"/tray/makemain", "/tray/cloudkey", "/tray/measure"} {
			code, res := callLocal(t, "POST", p, origin, `{"on":true,"key":"x"}`)
			if code != 403 {
				t.Fatalf("%s from the web page %s: %d %v (want 403)", p, origin, code, res)
			}
		}
	}
	if paused() {
		t.Fatal("a web page paused background reading")
	}
	if readStop() == nil {
		t.Fatal("a web page resumed reading")
	}
	// the tray itself (no Origin) still works
	if code, res := callLocal(t, "POST", "/tray/pause", "", `{"on":true}`); code != 200 || !paused() {
		t.Fatalf("the tray's pause: %d %v", code, res)
	}
	setPaused(false)
	if code, res := callLocal(t, "GET", "/tray/status", "", ""); code != 200 || res == nil {
		t.Fatalf("the tray's status: %d %v", code, res)
	}
	// the tray's own client sends no Origin header
	src, err := os.ReadFile("win_tray.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), `"Origin"`) {
		t.Fatal("win_tray.go sets an Origin header: the bridge would refuse the tray")
	}
	if !strings.Contains(string(src), `req.Header.Set("X-Bridge-Key"`) {
		t.Fatal("win_tray.go's trayCall changed: check that it still sends no Origin")
	}
}

// the Import fast path is the fixed header importEnvelope starts with, not '<TALLYREQUEST>Import' anywhere
func TestImportPathAnchored(t *testing.T) {
	// 2.2.0 (round 5: every id pinned to its builder): the posting as importEnvelope and the bridge's TALLYMESSAGE make it
	posting := importEnvelope("Vouchers", "ZZ", `<TALLYMESSAGE xmlns:UDF="TallyUDF"></TALLYMESSAGE>`)
	if id := tallyRequestID(posting); id != "Import" {
		t.Fatalf("a posting's id: %q", id)
	}
	if err := checkAllowed(posting); err != nil {
		t.Fatalf("a posting refused: %v", err)
	}
	// a collection not on the list, with the Import header's text inside a value
	sneaky := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>EvilDump</ID></HEADER>` +
		`<BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>X&lt;/SVCURRENTCOMPANY&gt;<TALLYREQUEST>Import Data</TALLYREQUEST></SVCURRENTCOMPANY></STATICVARIABLES>` +
		`<TDL><TDLMESSAGE><COLLECTION NAME="EvilDump"><TYPE>Ledger</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
	if id := tallyRequestID(sneaky); id != "EvilDump" {
		t.Fatalf("the id of a collection request with Import text inside: %q (want EvilDump)", id)
	}
	var na *notAllowedError
	if err := checkAllowed(sneaky); err == nil || !errors.As(err, &na) {
		t.Fatalf("a collection not on the list went through the Import fast path: %v", err)
	}
	if isPostingRequest(sneaky) {
		t.Fatal("a collection request counted as a posting")
	}
	// the header later in the request (after something else) is not a posting either
	late := `<ENVELOPE><X/>` + strings.TrimPrefix(importEnvelope("Vouchers", "ZZ", ""), "<ENVELOPE>")
	if tallyRequestID(late) == "Import" {
		t.Fatal("an Import header that is not at the start counted as a posting")
	}
	// a listed collection with the text inside a value: checked by its id (and allowed)
	listed := strings.Replace(allowListSamples()["TDSDeskCompanies"], "</ENVELOPE>", "<X><TALLYREQUEST>Import</TALLYREQUEST></X></ENVELOPE>", 1)
	if id := tallyRequestID(listed); id != "TDSDeskCompanies" {
		t.Fatalf("a listed collection with Import text: id %q", id)
	}
}
