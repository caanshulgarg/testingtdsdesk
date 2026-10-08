package main

// Crash reports to Sentry (crash.go; docs/sentry.md): the owner's conditions of 08-Oct-2026. Off unless the settings say
// "CrashReports": true AND the bridge is connected to the staging cloud; a panic only (never a log line, Tally's data,
// a company's name or a folder with a user's name); the bridge's version and Windows' version only. The envelope the
// real sentry-go transport posts is caught by a stand-in Sentry (httptest) and searched for the made-up business data of
// tests/fixtures/sentry-sensitive.json.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
)

type sentryFixture struct {
	Strings []string `json:"strings"`
	Tokens  []string `json:"tokens"`
	Texts   []string `json:"texts"`
}

func loadSentryFixture(t *testing.T) sentryFixture {
	t.Helper()
	b, err := os.ReadFile("../tests/fixtures/sentry-sensitive.json")
	if err != nil {
		t.Fatalf("the fixture: %v", err)
	}
	var f sentryFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f sentryFixture) leaks(s string) []string {
	var out []string
	for _, x := range append(append([]string{}, f.Strings...), f.Tokens...) {
		if strings.Contains(s, x) {
			out = append(out, x)
		}
	}
	return out
}

// a stand-in Sentry: every envelope posted to it
type standSentry struct {
	mu   sync.Mutex
	srv  *httptest.Server
	got  []string
	urls []string
}

func newStandSentry(t *testing.T) *standSentry {
	s := &standSentry{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.got = append(s.got, string(b))
		s.urls = append(s.urls, r.URL.String())
		s.mu.Unlock()
		w.WriteHeader(200)
	}))
	t.Cleanup(s.srv.Close)
	return s
}
func (s *standSentry) dsn() string {
	return strings.Replace(s.srv.URL, "http://", "http://0123456789abcdef0123456789abcdef@", 1) + "/4512221235642368"
}
func (s *standSentry) envelopes() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.got...)
}

func crashTestSettings(t *testing.T, on any, cloud string) {
	t.Helper()
	oldOn, oldURL := cfg("CrashReports"), cfg("CloudUrl")
	setCfg("CrashReports", on)
	setCfg("CloudUrl", cloud)
	t.Cleanup(func() { setCfg("CrashReports", oldOn); setCfg("CloudUrl", oldURL); crashStop() })
}

const stagingCloud = "https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest"

func TestCrashReportsOffUnlessEnabledOnStaging(t *testing.T) {
	s := newStandSentry(t)
	for _, c := range []struct {
		on    any
		cloud string
		want  bool
	}{
		{nil, stagingCloud, false},   // not in the settings: off
		{false, stagingCloud, false}, // said no
		{"yes", stagingCloud, false}, // only true itself
		{true, "", false},            // not connected to FinCom
		{true, "https://abcdefghijklmnopqrst.supabase.co/functions/v1/tally-ingest", false}, // another cloud than staging
		{true, "https://qbocskaiewaxqcvaunzc.supabase.co.evil.example/x", false},
		{true, stagingCloud, true},
	} {
		crashTestSettings(t, c.on, c.cloud)
		if got := crashStart(s.dsn()); got != c.want {
			t.Errorf("CrashReports=%v CloudUrl=%q: started %v, want %v", c.on, c.cloud, got, c.want)
		}
		crashReport("heartbeat", "a test panic")
		crashStop()
	}
	if n := len(s.envelopes()); n != 1 {
		t.Errorf("reports sent: %d, want 1 (only when on, on staging)", n)
	}
}

var crashAllowedEvent = map[string]bool{"event_id": true, "timestamp": true, "level": true, "platform": true, "release": true, "environment": true,
	"exception": true, "message": true, "tags": true, "contexts": true, "sdk": true}

func TestCrashReportCarriesNoBusinessData(t *testing.T) {
	fx := loadSentryFixture(t)
	s := newStandSentry(t)
	crashTestSettings(t, true, stagingCloud)
	if !crashStart(s.dsn()) {
		t.Fatal("not started")
	}
	// the log has business data in it; none of it may go with a report
	for _, x := range fx.Texts {
		writeLog("Tally answered: " + x)
	}
	// panics as the bridge's loops recover them: strings, errors, wrapped errors, a path error, a runtime error
	for _, x := range fx.Texts {
		crashReport("heartbeat", x)
		crashReport("posting_job", errors.New(x))
		crashReport("keep_in_step", fmt.Errorf("company %s: %w", "OMEGA HOLDINGS & CO", errors.New(x)))
	}
	crashReport("recorder", &fs.PathError{Op: "open", Path: `C:\Users\priya\AppData\Local\FinCom Bridge\27AAACZ9876K1Z3.xml`, Err: fs.ErrPermission})
	func() {
		defer func() { crashReport("light_check", recover()) }()
		var a []int
		_ = a[len(fx.Texts)] // index out of range: a runtime error
	}()
	crashFlush()
	envs := s.envelopes()
	if len(envs) < 5 {
		t.Fatalf("reports sent: %d", len(envs))
	}
	sawRuntime, sawFrame := false, false
	for _, env := range envs {
		if l := fx.leaks(env); len(l) > 0 {
			t.Errorf("business data in an envelope: %v\n%s", l, env)
		}
		for _, bad := range []string{"/home/", `Users`, "server_name", "breadcrumbs", "abs_path", "pre_context", "context_line", "\"request\"", "\"extra\"", "\"modules\""} {
			if strings.Contains(env, bad) {
				t.Errorf("%q in an envelope:\n%s", bad, env)
			}
		}
		lines := strings.Split(strings.TrimSpace(env), "\n")
		if len(lines) != 3 {
			t.Errorf("an envelope of one item: %d lines\n%s", len(lines), env)
			continue
		}
		var item map[string]any
		_ = json.Unmarshal([]byte(lines[1]), &item)
		if item["type"] != "event" {
			t.Errorf("item type %v, want event", item["type"])
		}
		var ev map[string]any
		if err := json.Unmarshal([]byte(lines[2]), &ev); err != nil {
			t.Fatal(err)
		}
		var keys []string
		for k, v := range ev {
			// sentry-go always writes "user": {} (empty); anything in it is a failure
			if u, ok := v.(map[string]any); k == "user" && ok && len(u) == 0 {
				continue
			}
			if !crashAllowedEvent[k] {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		if len(keys) > 0 {
			t.Errorf("fields not allowed in an event: %v", keys)
		}
		if ev["environment"] != "staging" || ev["release"] != "fincom-bridge-"+BridgeVersion || ev["platform"] != "go" {
			t.Errorf("environment %v, release %v, platform %v", ev["environment"], ev["release"], ev["platform"])
		}
		ctx, _ := ev["contexts"].(map[string]any)
		for k := range ctx {
			if k != "os" {
				t.Errorf("context %q: only Windows' version may go", k)
			}
		}
		tags, _ := ev["tags"].(map[string]any)
		for k := range tags {
			if k != "where" {
				t.Errorf("tag %q: only where", k)
			}
		}
		if strings.Contains(lines[2], "runtime error: index out of range") {
			sawRuntime = true
		}
		if regexp.MustCompile(`"function":"[^"]*TestCrashReportCarriesNoBusinessData`).MatchString(lines[2]) && strings.Contains(lines[2], `"filename":"crash_test.go"`) {
			sawFrame = true
		}
	}
	if !sawRuntime {
		t.Error("a runtime error's own words are kept (runtime error: index out of range ...)")
	}
	if !sawFrame {
		t.Error("the code location (function, file, line) is kept")
	}
}

func TestCrashTextSameRulesAsTheApp(t *testing.T) {
	fx := loadSentryFixture(t)
	for _, x := range fx.Texts {
		if l := fx.leaks(crashText(x)); len(l) > 0 {
			t.Errorf("crashText(%q) = %q leaks %v", x, crashText(x), l)
		}
	}
	for in, want := range map[string]string{
		"runtime error: invalid memory address or nil pointer dereference": "runtime error: invalid memory address or nil pointer dereference",
		"assignment to entry in nil map":                                   "assignment to entry in nil map",
		"Cannot read properties of undefined (reading 'vendorName')":       "Cannot read properties of undefined (reading 'vendorName')",
		"Ledger 'Zeta Supplies Ltd' does not exist":                        "Ledger … does not exist",
	} {
		if got := crashText(in); got != want {
			t.Errorf("crashText(%q) = %q, want %q", in, got, want)
		}
	}
	// the word list is the shared scrubber's (server/_shared/sentry-scrub.js), word for word
	js, err := os.ReadFile("../server/_shared/sentry-scrub.js")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)const WORDS = new Set\(\((.*?)\)\.split`).FindSubmatch(js)
	if m == nil {
		t.Fatal("WORDS not found in sentry-scrub.js")
	}
	var jsWords []string
	for _, q := range regexp.MustCompile(`"([^"]*)"`).FindAllSubmatch(m[1], -1) {
		jsWords = append(jsWords, strings.Fields(string(q[1]))...)
	}
	goWords := strings.Fields(crashWordList)
	sort.Strings(jsWords)
	sort.Strings(goWords)
	if strings.Join(jsWords, " ") != strings.Join(goWords, " ") {
		t.Errorf("crash.go's word list differs from server/_shared/sentry-scrub.js (%d words against %d)", len(goWords), len(jsWords))
	}
}
