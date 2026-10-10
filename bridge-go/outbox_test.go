package main

// next-outbox (item d): every line is kept on the PC until FinCom confirms it, and FinCom ignores a repeat. Tests
// written before the code: a kill mid-send, a restart, a cloud 500, a duplicate ("already have") answer, a pair whose
// halves sit in two daily files, the sent ids' rotation never older than what is still unconfirmed, a held file read
// past the 31-day window, the deliberate resends marked, and the posting results' outbox.

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a line of another company name under the same company GUID (the same daily file): a company renamed in Tally, its
// lines under the old name still waiting
func obLine(cname, ev, guid, mid, aid, narr string) string {
	return strings.Replace(vchLine(ev, guid, mid, aid, narr), "|cname="+zz+"|", "|cname="+cname+"|", 1)
}

// FinCom's import coming back (its FinCom id, the GUID its MasterID makes): never asked of Tally, so it goes at once
func obImport(cname string, mid int, fid string) []string {
	g := b220CoGUID + "-" + hex8(mid)
	return []string{obLine(cname, "import_object", g, itoa(mid), itoa(mid+100), "Bill | TDSDesk:"+fid),
		obLine(cname, "after_import_object", g, itoa(mid), itoa(mid+100), "Bill | TDSDesk:"+fid)}
}

func hex8(n int) string {
	const h = "0123456789abcdef"
	s := ""
	for i := 0; i < 8; i++ {
		s = string(h[n&15]) + s
		n >>= 4
	}
	return s
}

// a cloud that keeps every line once per line id, as migration 63 does: a repeat is answered "already have" with the
// state the first arrival got, and never stored again
type obCloud struct {
	stored map[string]int // line id -> arrivals that were stored (1 at most)
	repeat map[string]int // line id -> repeats answered "already have"
	down   func(b M) bool // answer 500 for this body
}

func (o *obCloud) reply(b M) (int, M) {
	if o.down != nil && o.down(b) {
		return 500, M{"ok": false, "error": "down"}
	}
	res := []any{}
	for _, x := range arr(b["lines"]) {
		id := str(obj(x)["line_id"])
		if o.stored[id] > 0 {
			o.repeat[id]++
			res = append(res, M{"line_id": id, "state": "applied", "why": "already have this line", "already": true})
			continue
		}
		o.stored[id]++
		res = append(res, M{"line_id": id, "state": "applied", "why": nil})
	}
	return 200, M{"ok": true, "results": res}
}

func obModel(c *standCloud) *obCloud {
	o := &obCloud{stored: map[string]int{}, repeat: map[string]int{}}
	c.mu.Lock()
	c.recReply = o.reply
	c.mu.Unlock()
	return o
}

// what the sync folder holds of the recorder (the offsets and the sent ids), to put back as a bridge killed before it
// wrote them would have left them
func obSnapshot(t *testing.T) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	for _, p := range append([]string{sp("recorder-offsets.json")}, globAll(filepath.Join(syncDir(), "recorder-sent"))...) {
		if b, err := os.ReadFile(p); err == nil {
			out[p] = b
		}
	}
	return out
}

func globAll(dir string) []string { m, _ := filepath.Glob(filepath.Join(dir, "*")); return m }

func obRestore(t *testing.T, snap map[string][]byte) {
	t.Helper()
	_ = os.Remove(sp("recorder-offsets.json"))
	_ = os.RemoveAll(filepath.Join(syncDir(), "recorder-sent"))
	for p, b := range snap {
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// --- 1. killed after FinCom stored the group but before the bridge wrote its marks: the restart sends the lines again,
// FinCom answers "already have", the bridge marks them sent; nothing is stored twice, nothing is lost
func TestOutboxKillAfterCloudStored(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	o := obModel(c)
	p := liveFilePath(rec, "")
	for i := 0; i < 3; i++ {
		liveAppend(t, p, obImport(zz, 0x40+i, "fa"+itoa(i))...)
	}
	liveReadOnce()
	snap := obSnapshot(t) // what was on disk before the send
	uploadAll(t)
	if len(o.stored) != 3 {
		t.Fatalf("stored: %d", len(o.stored))
	}
	obRestore(t, snap) // the kill: the marks never reached the disk
	liveResetState()
	readAndUploadAll(t)
	if len(o.stored) != 3 || len(o.repeat) != 3 {
		t.Fatalf("after the restart: stored %d, repeats answered %d (want 3 and 3)", len(o.stored), len(o.repeat))
	}
	if q := liveQueue(); len(q) != 0 {
		t.Fatalf("the repeats answered \"already have\" are still waiting: %d", len(q))
	}
	// marked sent on that answer: a further restart sends nothing
	n := len(c.recRaw)
	liveResetState()
	readAndUploadAll(t)
	if len(c.recRaw) != n {
		t.Fatalf("lines answered \"already have\" went again after a restart (%d calls, was %d)", len(c.recRaw), n)
	}
}

// --- 2. killed mid-send (the connection dropped, no answer) and a cloud 500: nothing marked, nothing moved; the restart
// sends every line once
func TestOutboxKillMidSendAndCloud500(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	o := obModel(c)
	p := liveFilePath(rec, "")
	liveAppend(t, p, obImport(zz, 0x50, "fb0")...)
	liveAppend(t, p, obImport(zz, 0x51, "fb1")...)
	liveReadOnce()
	// the connection dropped mid-send: no answer at all
	drop := true
	hj := c.srv.Config.Handler
	c.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if drop && strings.Contains(string(b), `"recorder_lines"`) && strings.Contains(string(b), `"line_id"`) {
			if h, ok := w.(http.Hijacker); ok {
				if conn, _, err := h.Hijack(); err == nil {
					conn.Close()
					return
				}
			}
		}
		r.Body = io.NopCloser(bytes.NewReader(b))
		hj.ServeHTTP(w, r)
	})
	uploadAll(t)
	if len(o.stored) != 0 || len(liveQueue()) != 2 {
		t.Fatalf("a dropped send: stored %d, waiting %d", len(o.stored), len(liveQueue()))
	}
	// the restart, then a 500
	liveResetState()
	drop = false
	o.down = func(M) bool { return true }
	readAndUploadAll(t)
	if len(o.stored) != 0 || len(liveQueue()) != 2 {
		t.Fatalf("a 500: stored %d, waiting %d", len(o.stored), len(liveQueue()))
	}
	// FinCom back: every line once
	o.down = nil
	liveResetBackoff()
	readAndUploadAll(t)
	if len(o.stored) != 2 || len(o.repeat) != 0 || len(liveQueue()) != 0 {
		t.Fatalf("back: stored %d, repeats %d, waiting %d", len(o.stored), len(o.repeat), len(liveQueue()))
	}
}

// --- 3. a save whose pre line is in one daily file and its post in the next (a save across midnight): not sent when
// the bridge stops; after the restart it is sent (the offsets of BOTH files wait for it)
func TestOutboxPairAcrossFilesKept(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	o := obModel(c)
	d1, d2 := liveFilePath(rec, "20261004"), liveFilePath(rec, "20261005")
	// the first file has lines sent before (its offset well past the second file's size)
	for i := 0; i < 4; i++ {
		liveAppend(t, d1, obImport(zz, 0x60+i, "fc"+itoa(i))...)
	}
	readAndUploadAll(t)
	if len(o.stored) != 4 {
		t.Fatalf("first lines: %d", len(o.stored))
	}
	// the pair: its first half in the first file, its second in the next
	pair := obImport(zz, 0x71, "fe0")
	o.down = func(M) bool { return true }
	liveAppend(t, d1, pair[0])
	liveAppend(t, d2, pair[1])
	readAndUploadAll(t)
	if q := liveQueue(); len(q) != 1 || q[0].event != "imported" {
		t.Fatalf("the pair: %+v", q)
	}
	liveResetState() // stopped before FinCom took it
	o.down = nil
	readAndUploadAll(t)
	if len(o.stored) != 5 {
		t.Fatalf("the pair across two files was lost on a restart: %d stored (want 5)", len(o.stored))
	}
}

// two lines of the same daily file under two company names: the first's company is refused (500) for days, the second
// is sent. Returns the cloud model and the sent line's id
func obHeldBehind(t *testing.T) (*obCloud, *standCloud, string) {
	t.Helper()
	rec, _, c := liveBridge(t, "")
	liveSeedOwnOpen(b220CoGUID, "ZZ OLD")
	o := obModel(c)
	o.down = func(b M) bool { return str(b["company"]) == "ZZ OLD" && len(arr(b["lines"])) > 0 }
	p := liveFilePath(rec, "")
	liveAppend(t, p, obImport("ZZ OLD", 0x80, "ff0")...)
	liveAppend(t, p, obImport(zz, 0x81, "ff1")...)
	readAndUploadAll(t)
	uploadAll(t)
	if len(o.stored) != 1 {
		t.Fatalf("stored: %d", len(o.stored))
	}
	var sent string
	for id := range o.stored {
		sent = id
	}
	if q := liveQueue(); len(q) != 1 || q[0].company != "ZZ OLD" {
		t.Fatalf("waiting: %+v", q)
	}
	return o, c, sent
}

// --- 4. the sent ids are rotated after 7 days only once nothing older is unconfirmed: a line sent 8 days ago behind one
// still waiting is never sent twice after a restart
func TestOutboxSentIdsNotRotatedBeforeConfirmation(t *testing.T) {
	o, _, sent := obHeldBehind(t)
	laterBy(t, 8*24*time.Hour)
	liveResetState()
	o.down = nil
	readAndUploadAll(t)
	if o.repeat[sent] != 0 {
		t.Fatalf("the line sent 8 days ago went again after a restart (its sent id rotated before the line before it was confirmed)")
	}
	if len(o.stored) != 2 {
		t.Fatalf("stored: %d (want 2)", len(o.stored))
	}
	// confirmed now: the next restart rotates the old ids
	liveResetState()
	live.mu.Lock()
	liveFresh()
	had := live.sent[sent]
	live.mu.Unlock()
	if had {
		t.Fatal("the old sent ids were kept after every line before them was confirmed")
	}
}

// --- 5. a file with a line not yet confirmed is read whatever its age (the 31-day window is for files never read)
func TestOutboxHeldFileOlderThan31Days(t *testing.T) {
	o, _, sent := obHeldBehind(t)
	laterBy(t, 32*24*time.Hour)
	liveResetState()
	o.down = nil
	readAndUploadAll(t)
	if len(o.stored) != 2 {
		t.Fatalf("the line waiting 32 days was dropped: %d stored (want 2)", len(o.stored))
	}
	if o.repeat[sent] != 0 {
		t.Fatal("the line confirmed 32 days ago went again")
	}
}

// --- 6. a full disk: the marks cannot be written; the line is still sent once (FinCom's "already have" covers the
// restart) and nothing is lost
func TestOutboxFullDisk(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	o := obModel(c)
	p := liveFilePath(rec, "")
	liveAppend(t, p, obImport(zz, 0x90, "fg0")...)
	liveReadOnce()
	snap := obSnapshot(t)
	// the sync folder's files cannot be written: a directory where each file should be
	sentDir := filepath.Join(syncDir(), "recorder-sent")
	_ = os.RemoveAll(sentDir)
	_ = os.WriteFile(sentDir, []byte("full"), 0o644) // recorder-sent is a file: no id can be written under it
	_ = os.Remove(sp("recorder-offsets.json"))
	_ = os.MkdirAll(sp("recorder-offsets.json"), 0o755) // nor the offsets
	uploadAll(t)
	if len(o.stored) != 1 {
		t.Fatalf("stored: %d", len(o.stored))
	}
	_ = os.Remove(sentDir)
	_ = os.RemoveAll(sp("recorder-offsets.json"))
	obRestore(t, snap)
	liveResetState()
	readAndUploadAll(t)
	if len(o.stored) != 1 || len(liveQueue()) != 0 {
		t.Fatalf("after the disk came back: stored %d, waiting %d", len(o.stored), len(liveQueue()))
	}
}

// --- 8. the posting results' outbox: a finished posting stays in sync\cloud-posts.txt until FinCom answers 200; a 500
// keeps it (across a restart); FinCom's answer to a repeat of a settled posting (stale, settled) takes it off
func TestOutboxPostingResults(t *testing.T) {
	f := r6Tally(t, func() bool { return false })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
	cpMu.Lock()
	cloudPosts = nil
	cpMu.Unlock()
	down := true
	c.mu.Lock()
	c.postsReply = func(b M) (int, M) {
		if down {
			return 500, M{"ok": false, "error": "down"}
		}
		return 200, M{"ok": true, "stale": true, "settled": true, "status": "done"}
	}
	id := "emuqtw0683g091"
	c.takeJobs = append(c.takeJobs, M{"id": "job-ob-1", "company": zz, "payload": M{"vouchers": []any{M{"id": id, "xml": f1Voucher(id, "")}}}})
	c.mu.Unlock()
	cloudPostTake()
	r6Done(t, "job-ob-1")
	for i := 0; i < 3; i++ {
		postsDirty.Store(true)
		syncCloudPosts()
	}
	if !strings.Contains(readText(cloudPostsFile()), "job-ob-1") {
		t.Fatal("a posting whose result FinCom did not take left the outbox")
	}
	// a restart
	cpMu.Lock()
	cloudPosts = nil
	cpMu.Unlock()
	down = false
	postsDirty.Store(true)
	syncCloudPosts()
	if strings.Contains(readText(cloudPostsFile()), "job-ob-1") {
		t.Fatal("FinCom's answer to a repeat (settled) did not take the posting off the outbox")
	}
}
