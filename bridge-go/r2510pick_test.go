package main

// bridge 2.5.10: the pick-up acknowledgement (pickack.go) and Stop posting's reasons (jobs.go cancelAsked)
import (
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func r2510List(chosen, kind string, days ...string) M {
	l := pullList(days...)
	for _, x := range arr(l["periodDays"]) {
		obj(x)["chosenAt"] = chosen
		if kind != "" {
			obj(x)["kind"] = kind
		}
	}
	return l
}

func TestR2510PickLogin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the Windows login comes from Windows")
	}
	old := os.Getenv("USER")
	defer os.Setenv("USER", old)
	for in, want := range map[string]string{`SRV01\made-up-a`: "made-up-a", "made-up-b@corp.example": "made-up-b", "made-up-c": "made-up-c"} {
		os.Setenv("USER", in)
		if g := pickLogin(); g != want {
			t.Fatalf("%s: %s", in, g)
		}
	}
}

func r2510Drain() {
	for {
		select {
		case <-beatNow:
		default:
			return
		}
	}
}

func r2510Soon() bool {
	select {
	case <-beatNow:
		return true
	default:
		return false
	}
}

func r2510Acks() []M {
	var o []M
	for _, x := range pickBeat() {
		o = append(o, obj(x))
	}
	return o
}

// taken from the beat answer: nothing said until the loop starts it; then started (the first day, when, the login) at once
func TestR2510PickStartedOnTake(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250915", 700, "Sales", "Receipt")
	chosen := nowFn().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	applyPeriodDays(r2510List(chosen, "period", "20250915", "20250914"))
	if a := r2510Acks(); len(a) != 0 {
		t.Fatalf("said before the loop looked: %v", a)
	}
	r2510Drain()
	if s, _ := pullStep(); !s {
		t.Fatal("the first request did not go")
	}
	if !r2510Soon() {
		t.Fatal("the beat was not asked for at once")
	}
	a := r2510Acks()
	if len(a) != 1 {
		t.Fatalf("acks: %v", a)
	}
	x := a[0]
	if str(x["state"]) != "started" || str(x["kind"]) != "period" || str(x["day"]) != "20250915" || str(x["chosenAt"]) != chosen ||
		str(x["company"]) != zz || !strings.EqualFold(str(x["guid"]), b220CoGUID) || str(x["code"]) != "" {
		t.Fatalf("the ack: %v", x)
	}
	if _, err := time.Parse(time.RFC3339, str(x["pickedAt"])); err != nil || !strings.HasSuffix(str(x["pickedUtc"]), "Z") || str(x["login"]) != pickLogin() || strings.ContainsAny(str(x["login"]), `\/`) {
		t.Fatalf("when and who: %v", x)
	}
	taken := str(x["takenAt"])
	// the same choice listed again: the same hand-out (no new acknowledgement)
	pullRun(t, 20)
	applyPeriodDays(r2510List(chosen, "period", "20250914"))
	if a := r2510Acks(); len(a) != 1 || str(a[0]["takenAt"]) != taken || str(a[0]["day"]) != "20250915" {
		t.Fatalf("listed again under the same choice: %v", a)
	}
	// a new choice: a new hand-out, started on its own first day
	at := nowFn().Add(time.Minute)
	nowFn = func() time.Time { return at }
	chosen2 := at.UTC().Format(time.RFC3339Nano)
	applyPeriodDays(r2510List(chosen2, "period", "20250913"))
	pullRun(t, 20)
	a = r2510Acks()
	if len(a) != 1 || str(a[0]["takenAt"]) == taken || str(a[0]["chosenAt"]) != chosen2 || str(a[0]["day"]) != "20250913" || str(a[0]["state"]) != "started" {
		t.Fatalf("a new choice: %v", a)
	}
	// listed again after 10 minutes of not being listed (a press of Bring missing days keeps the choice time): new
	applyPeriodDays(M{"periodDays": []any{}})
	at2 := at.Add(11 * time.Minute)
	nowFn = func() time.Time { return at2 }
	applyPeriodDays(r2510List(chosen2, "period", "20250912"))
	if a2 := r2510Acks(); len(a2) != 0 {
		t.Fatalf("the earlier hand-out still said once it is listed anew: %v", a2)
	}
}

// each reason the loop finds is said with its code and words; once clear, started
func TestR2510PickRefusalReasons(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250701", 1400, "Sales", "Receipt")
	try := func(code string, set, unset func()) {
		t.Helper()
		pickReset()
		applyPeriodDays(r2510List(nowFn().UTC().Format(time.RFC3339), "check", "20250701"))
		set()
		openMu.Lock()
		runSeen = time.Time{}
		openMu.Unlock()
		r2510Drain()
		n := len(f.ids())
		pullRun(t, 3)
		if got := f.ids()[n:]; len(got) != 0 {
			t.Fatalf("%s: sent %v", code, got)
		}
		a := r2510Acks()
		if len(a) != 1 || str(a[0]["state"]) != "refused" || str(a[0]["code"]) != code || str(a[0]["words"]) != pickWords[code] || str(a[0]["kind"]) != "check" {
			t.Fatalf("%s: the ack %v", code, a)
		}
		if a[0]["pickedAt"] != nil || !r2510Soon() {
			t.Fatalf("%s: a refusal with a pick time, or not said at once: %v", code, a[0])
		}
		// another reason within 15 s: kept for the next beat, no early beat for it
		pickRefused(pullItem{Company: zz, CGUID: b220CoGUID, Kind: "check"}, "tallyBusy")
		if r2510Soon() || str(r2510Acks()[0]["code"]) != "tallyBusy" {
			t.Fatalf("%s: a second reason within 15 s: %v", code, r2510Acks())
		}
		unset()
		openMu.Lock()
		runSeen = time.Time{}
		openMu.Unlock()
		pullRun(t, 10)
		if a := r2510Acks(); len(a) != 1 || str(a[0]["state"]) != "started" || str(a[0]["code"]) != "" {
			t.Fatalf("%s cleared: %v", code, a)
		}
		pullReset()
	}
	try("tallyClosed", func() { tallyStandInClosed = true }, func() { tallyStandInClosed = false })
	try("paused", func() { pausedB = true }, func() { pausedB = false })
	try("readingStopped", func() { setReadStop("fincom", "test") }, func() { clearReadStop("test") })
	try("posting", func() { importsInFlight.Add(1) }, func() { importsInFlight.Add(-1) })
	try("retryWait", func() { retryNote(f.port, "x", errRecorderStop) }, func() { retryReset() })
	try("notAnswering", func() { tallyNotResponding.Store(true) }, func() { tallyNotResponding.Store(false) })
	try("typing", func() {
		_ = os.WriteFile(filepath.Join(recorderDirFn(), b220CoGUID+".txt"), []byte("FCR1|ev=create\n"), 0o644)
		recorderWatchReset()
	}, func() {
		old := time.Now().Add(-10 * time.Minute)
		_ = os.Chtimes(filepath.Join(recorderDirFn(), b220CoGUID+".txt"), old, old)
		recorderWatchReset()
	})
	try("notOpen", func() {
		live.mu.Lock()
		liveFresh()
		live.own, live.ownCur = map[string]*liveOwnSt{}, map[string]bool{}
		live.mu.Unlock()
		_ = os.Remove(liveOwnTallyFile())
	}, func() { liveSeedOwnOpen(b220CoGUID, zz) })
	// the reasons' words: plain, never a port, a computer or a login
	for c, w := range pickWords {
		if w == "" || strings.ContainsAny(w, "0123456789<>") && c != "slow" || strings.Contains(w, "port") {
			t.Fatalf("%s: %q", c, w)
		}
	}
}

// days FinCom listed that this bridge will not read: another copy of the company, a company not held, a stop; the other
// kinds of the same book wait their turn ("queued"); the kind as FinCom names it (an older cloud: check by its flag)
func TestR2510PickNotTakenAndQueued(t *testing.T) {
	f, _, _ := pullBridge(t)
	pullDay(f, "20250801", 1500, "Sales")
	pullDay(f, "20250802", 1600, "Sales")
	ch := nowFn().UTC().Format(time.RFC3339)
	l := M{"periodDays": []any{
		M{"company": zz, "company_guid": b220CoGUID, "day": "20250802", "fetch": true, "chosenAt": ch, "kind": "period"},
		M{"company": zz, "company_guid": b220CoGUID, "day": "20250801", "fetch": true, "chosenAt": ch, "kind": "fill"},
		M{"company": zz, "company_guid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "day": "20250801", "fetch": true, "chosenAt": ch, "kind": "check"},
		M{"company": "NOT HELD CO", "company_guid": "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff", "day": "20250801", "fetch": true, "chosenAt": ch}}}
	applyPeriodDays(l)
	by := map[string]M{}
	for _, a := range r2510Acks() {
		by[str(a["company"])+"|"+str(a["kind"])] = a
	}
	if a := by[zz+"|check"]; str(a["code"]) != "otherCompany" || str(a["state"]) != "refused" {
		t.Fatalf("another copy: %v", by)
	}
	if a := by["NOT HELD CO|period"]; str(a["code"]) != "notOpen" {
		t.Fatalf("not held: %v", by)
	}
	if _, has := by[zz+"|period"]; has {
		t.Fatalf("said before the loop: %v", by)
	}
	if s, _ := pullStep(); !s {
		t.Fatal("the first request did not go")
	}
	by = map[string]M{}
	for _, a := range r2510Acks() {
		by[str(a["company"])+"|"+str(a["kind"])] = a
	}
	if str(by[zz+"|period"]["state"]) != "started" || str(by[zz+"|fill"]["code"]) != "queued" {
		t.Fatalf("one day at a time: %v", by)
	}
	pullRun(t, 30)
	by = map[string]M{}
	for _, a := range r2510Acks() {
		by[str(a["company"])+"|"+str(a["kind"])] = a
	}
	if str(by[zz+"|fill"]["state"]) != "started" || str(by[zz+"|fill"]["day"]) != "20250801" {
		t.Fatalf("its turn: %v", by)
	}
	for in, want := range map[string]string{`{"kind":"fill"}`: "fill", `{"check":true}`: "check", `{"kind":"made up"}`: "period", `{}`: "period", `{"kind":"check","check":false}`: "check"} {
		if k := pickKindOf(parseObj(in)); k != want {
			t.Fatalf("%s: %s", in, k)
		}
	}
	// a stop of this company under the choice: said "stopped"
	pullReset()
	pull.mu.Lock()
	pull.stopCo[companyKey(zz)] = M{"company": zz, "day": "20250801", "why": "over2s", "chosenAt": ch, "at": ch}
	pull.mu.Unlock()
	applyPeriodDays(r2510List(ch, "period", "20250801"))
	if a := r2510Acks(); len(a) != 1 || str(a[0]["code"]) != "stopped" {
		t.Fatalf("stopped: %v", a)
	}
}

// the beat stays small: at most 20, none older than 30 minutes, each field cut; in the beat's body as pickups
func TestR2510PickBeatBound(t *testing.T) {
	pullBridge(t)
	long := strings.Repeat("Ä", 300)
	var items []pullItem
	for i := 0; i < 45; i++ {
		items = append(items, pullItem{Company: long + fmt.Sprint(i), CGUID: strings.Repeat("a", 100), Day: "20250801", ChosenAt: strings.Repeat("9", 60), Kind: "period"})
	}
	pickTake(items, nil, nil)
	for _, it := range items {
		pickRefused(it, "notOpen")
	}
	a := pickBeat()
	if len(a) != pickMax {
		t.Fatalf("%d said", len(a))
	}
	if n := len(jsonText(a)); n > 20*1024 {
		t.Fatalf("the beat's acknowledgements: %d bytes", n)
	}
	for _, x := range a {
		e := obj(x)
		if len([]rune(str(e["company"]))) > 200 || len(str(e["guid"])) > 100 || len(str(e["chosenAt"])) > 40 {
			t.Fatalf("not cut: %v", e)
		}
	}
	b := beatBody(false, "closed", "", nil, nil, nil)
	if l, ok := b["pickups"].([]any); !ok || len(l) != pickMax {
		t.Fatalf("the beat's pickups: %T %d", b["pickups"], len(arr(b["pickups"])))
	}
	at := nowFn().Add(31 * time.Minute)
	nowFn = func() time.Time { return at }
	if a := pickBeat(); len(a) != 0 {
		t.Fatalf("kept after 30 minutes: %d", len(a))
	}
	if l, ok := beatBody(false, "closed", "", nil, nil, nil)["pickups"].([]any); !ok || l == nil || len(l) != 0 {
		t.Fatal("no acknowledgement: not an empty list")
	}
}

// --- Stop posting (POST /jobs/cancel): each refusal says why, in a code and words; what may be stopped is as before
func r2510Job(t *testing.T, id string, p M, alive bool) string {
	t.Helper()
	dir, err := jobDir(id)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(dir, 0o755)
	if p != nil {
		p["id"] = id
		if err := writeProgress(dir, p); err != nil {
			t.Fatal(err)
		}
	}
	jobsMu.Lock()
	jobsRunning[id] = alive
	jobsMu.Unlock()
	t.Cleanup(func() {
		jobsMu.Lock()
		delete(jobsRunning, id)
		jobsMu.Unlock()
	})
	return dir
}

func TestR2510StopPostingReasons(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"own-user-key"`)
	oldP, oldO := peerUserOf, ownSIDsOf
	defer func() { peerUserOf, ownSIDsOf = oldP, oldO }()
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	who := sidAnshul
	peerUserOf = func(local, remote int, _ time.Time) (string, bool, error) { return who, true, nil }
	call := func(id string) (int, M) {
		r := httptest.NewRequest("POST", "http://127.0.0.1:9100/jobs/cancel", strings.NewReader(jsonText(M{"id": id})))
		r.RemoteAddr = "127.0.0.1:50123"
		r.Header.Set("X-Bridge-Key", "own-user-key")
		r.Header.Set("Origin", "https://app.fincom.live")
		w := httptest.NewRecorder()
		handle(w, r)
		return w.Code, parseObj(w.Body.String())
	}
	refused := func(what string, code int, res M, want string, wantCode int) {
		t.Helper()
		if code != wantCode || res["ok"] != false || str(res["code"]) != want || str(res["error"]) != cancelWords[want] || str(res["words"]) != cancelWords[want] {
			t.Fatalf("%s: %d %v", what, code, res)
		}
		// the page's "did not answer" test never takes these words for a bridge not answering
		if re(`(?i)failed to fetch|networkerror|load failed|timed? ?out|aborted|refused|not answering`).MatchString(str(res["error"])) {
			t.Fatalf("%s: words the page reads as no answer: %q", what, res["error"])
		}
	}
	c, r := call("job-none-2510")
	refused("no such posting here", c, r, "notHere", 404)
	c, r = call("x")
	refused("not a posting number", c, r, "notHere", 404)
	r2510Job(t, "job-empty-2510", nil, false)
	c, r = call("job-empty-2510")
	refused("its folder, nothing in it", c, r, "notFound", 404)
	dd := r2510Job(t, "job-done-2510", M{"status": "done", "message": "Posted 2 of 2", "updatedAt": time.Now().Format(time.RFC3339Nano)}, false)
	c, r = call("job-done-2510")
	refused("finished", c, r, "alreadySent", 409)
	if exists(filepath.Join(dd, "cancel")) || str(readProgress(dd)["status"]) != "done" {
		t.Fatal("a finished posting was marked")
	}
	dn := r2510Job(t, "job-now-2510", M{"status": "running", "message": "Sending 3 of 9", "inflight": []any{"a1", "a2"}, "updatedAt": time.Now().Format(time.RFC3339Nano)}, true)
	// review of 2.5.10 (4): the stop is set, so it is answered 200, with the words of what happens
	c, r = call("job-now-2510")
	if c != 200 || r["ok"] != true || str(r["code"]) != "postingNow" || str(r["words"]) != cancelWords["postingNow"] || r["stopAsked"] != true || !exists(filepath.Join(dn, "cancel")) {
		t.Fatalf("a request at Tally now: %d %v", c, r)
	}
	// as before: a posting waiting for Tally, or one stopped part-way, is stopped
	dw := r2510Job(t, "job-wait-2510", M{"status": "waiting", "message": "Waiting for Tally", "updatedAt": time.Now().Format(time.RFC3339Nano)}, true)
	if c, r = call("job-wait-2510"); c != 200 || !exists(filepath.Join(dw, "cancel")) {
		t.Fatalf("waiting: %d %v", c, r)
	}
	di := r2510Job(t, "job-part-2510", M{"status": "running", "message": "Sending", "updatedAt": time.Now().Add(-time.Minute).Format(time.RFC3339Nano)}, false)
	if c, r = call("job-part-2510"); c != 200 || str(r["status"]) != "cancelled" || str(readProgress(di)["status"]) != "cancelled" {
		t.Fatalf("stopped part-way: %d %v", c, r)
	}
	// another Windows login's program: refused with its reason, and the page's own sign (notYours) as before
	who = sidRavi
	c, r = call("job-wait-2510")
	if c != 403 || r["notYours"] != true || str(r["code"]) != "otherLogin" || str(r["words"]) != cancelWords["otherLogin"] || str(r["error"]) != "not your FinCom Bridge" {
		t.Fatalf("another login: %d %v", c, r)
	}
	// the cloud's own cancel (cloud.go) and a done job: unchanged (cancelJob)
	if _, err := cancelJob("job-done-2510", "cancelled in FinCom"); err != nil || str(readProgress(dd)["status"]) != "done" {
		t.Fatalf("the cloud's cancel of a done posting: %v", err)
	}
}
