// Talking to Tally: one request at a time to each Tally, FinCom's requests before the routine copy, a Tally that did not
// answer left alone for a while, and every request timed (bridge 1.14.x rules, keep.ps1 and the base script).
package main

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// --- text from Tally: UTF-16 with or without a mark, or UTF-8
func textFromBytes(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		return utf16le(b[2:])
	}
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return string(b[3:])
	}
	zeros, n := 0, minI(len(b), 400)
	for i := 1; i < n; i += 2 {
		if b[i] == 0 {
			zeros++
		}
	}
	if n > 10 && zeros > n/4 {
		return utf16le(b)
	}
	if !utf8.Valid(b) {
		// fault 1 (03-Oct-2026): Tally answers non-ASCII text in its Windows code page (an em dash as the one byte 0x97);
		// read as Windows-1252, so the XML decoder never stops at it (it cut a narration, and every voucher after it)
		return fromCP1252(b)
	}
	return string(b)
}

// Windows-1252 bytes as text: 0x80-0x9F by their table (the dashes, curly quotes, euro), the rest as Latin-1
func fromCP1252(b []byte) string {
	var o strings.Builder
	o.Grow(len(b) + 16)
	for _, c := range b {
		switch {
		case c < 0x80:
			o.WriteByte(c)
		case c >= 0xA0:
			o.WriteRune(rune(c))
		default:
			if r := cp1252High[c-0x80]; r != 0 {
				o.WriteRune(r)
			}
		}
	}
	return o.String()
}

var cp1252High = [32]rune{0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
	0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178}

func utf16le(b []byte) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return string(utf16.Decode(u))
}

// Tally sometimes sends characters that are not allowed in XML (ConvertTo-CleanXml)
func cleanXML(t string) string {
	if !utf8.ValidString(t) {
		t = fromCP1252([]byte(t)) // text that did not come through textFromBytes (a file, a test): the same rule
	}
	t = re(`&#(x0*[0-8bBcCeEfF]|x0*1[0-9a-fA-F]|0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);`).ReplaceAllString(t, "")
	t = re("[\x00-\x08\x0B\x0C\x0E-\x1F]").ReplaceAllString(t, "")
	// a bare & that is not part of an entity
	if !strings.Contains(t, "&") {
		return t
	}
	var b strings.Builder
	ent := re(`^&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);`)
	for i := 0; i < len(t); i++ {
		if t[i] == '&' && !ent.MatchString(t[i:minI(len(t), i+12)]) {
			b.WriteString("&amp;")
			continue
		}
		b.WriteByte(t[i])
	}
	return b.String()
}

// --- a small XML tree, read without namespace checking (Tally writes <UDF:...> without declaring it)
type Node struct {
	Name string
	Attr map[string]string
	Kids []*Node
	text strings.Builder
}

func xmlDoc(text string) *Node {
	root := &Node{Name: "#document"}
	d := xml.NewDecoder(strings.NewReader(cleanXML(text)))
	d.Strict = false
	d.AutoClose = xml.HTMLAutoClose
	d.Entity = xml.HTMLEntity
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	stack := []*Node{root}
	for {
		tok, err := d.RawToken()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			n := &Node{Name: qname(t.Name), Attr: map[string]string{}}
			for _, a := range t.Attr {
				n.Attr[qname(a.Name)] = a.Value
			}
			p := stack[len(stack)-1]
			p.Kids = append(p.Kids, n)
			stack = append(stack, n)
		case xml.EndElement:
			name := qname(t.Name)
			for i := len(stack) - 1; i > 0; i-- {
				if stack[i].Name == name {
					stack = stack[:i]
					break
				}
			}
		case xml.CharData:
			stack[len(stack)-1].text.Write(t)
		}
	}
	return root
}
func qname(n xml.Name) string {
	if n.Space != "" {
		return n.Space + ":" + n.Local
	}
	return n.Local
}

// InnerText: every text inside the node
func (n *Node) InnerText() string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	var walk func(*Node)
	walk = func(x *Node) {
		b.WriteString(x.text.String())
		for _, k := range x.Kids {
			walk(k)
		}
	}
	walk(n)
	return b.String()
}

// Descendants with a name ("//NAME"); "*" for every element
func (n *Node) All(name string) []*Node {
	var o []*Node
	var walk func(*Node)
	walk = func(x *Node) {
		for _, k := range x.Kids {
			if name == "*" || k.Name == name {
				o = append(o, k)
			}
			walk(k)
		}
	}
	if n != nil {
		walk(n)
	}
	return o
}

// Children by a path ("A/B"), or several names ("A | B")
func (n *Node) Sel(path string) []*Node {
	if n == nil {
		return nil
	}
	if strings.Contains(path, "|") {
		names := map[string]bool{}
		for _, p := range strings.Split(path, "|") {
			names[strings.TrimSpace(p)] = true
		}
		var o []*Node
		for _, k := range n.Kids {
			if names[k.Name] {
				o = append(o, k)
			}
		}
		return o
	}
	cur := []*Node{n}
	for _, part := range strings.Split(path, "/") {
		var next []*Node
		for _, c := range cur {
			for _, k := range c.Kids {
				if k.Name == part {
					next = append(next, k)
				}
			}
		}
		cur = next
	}
	return cur
}
func (n *Node) One(path string) *Node {
	s := n.Sel(path)
	if len(s) == 0 {
		return nil
	}
	return s[0]
}

// Get-NodeText
func nt(n *Node, path string) string {
	if n == nil {
		return ""
	}
	return strings.TrimSpace(n.One(path).InnerText())
}
func (n *Node) A(k string) string {
	if n == nil || n.Attr == nil {
		return ""
	}
	return n.Attr[k]
}

// a node's NAME attribute, else its NAME child
func nameOf(n *Node) string {
	if v := n.A("NAME"); v != "" {
		return v
	}
	return nt(n, "NAME")
}

func collectionRequest(id, typ, fetch, company, extra string) string {
	sv := "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
	if company != "" {
		sv += "<SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>"
	}
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>" + id + "</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES>" + sv + "</STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="` + id + `" ISMODIFY="No"><TYPE>` + typ + "</TYPE><FETCH>" + fetch + "</FETCH>" + extra + "</COLLECTION>" +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

// --- who asks: FinCom (a person waiting: a posting, Update now, a read FinCom asked for) or the copier (a background
// read), which always gives way: 2.1.3 stops a background read at once (its request to Tally is closed) when FinCom's
// request comes, and the read goes on from where it was afterwards
type TC struct {
	copier  bool
	readSec int    // the copier: no read of the day book may hold Tally longer than this
	enc     string // round 18: "utf-16" or "utf-8" for this request whatever TallyRequestUTF16 says ("": as the setting says)
	// round 19 (review finding 1): a request a person started (the tray's read test, the measuring tool with ReadDays on
	// or --old-days typed at the console): the only requests carrying a period that go while ReadDays is off
	person bool
	// round 19: the recorder trial's time saving (trial.go): its imports are not noted as postings (no read-back, nothing
	// for the cloud)
	bench bool
	// round 19 (review finding 8): a background read asks this right after it took the Tally lock; true: it gives the
	// lock back and backs off (a posting job started, or the company's lease was taken, while it waited)
	yield func() bool
	// 2.2.0 (the owner's rule for the recorder's source B): told the wall time from the send to the full answer (or
	// the failure), the wait for Tally's lock not counted
	timed func(seconds float64)
}

// round 19 (review finding 1, the owner's rule "reading is prospective only", by any route): a request carrying a period
// (SVFROMDATE / SVTODATE, any date form) goes to Tally only when ReadDays is on or a person started it
//
// 2.2.0 (the owner's rule, prospective only): one narrow exception, the recorder's body fetch (FinComVoucherByMaster):
// it asks only the entries just changed, by MasterID, with the line's own date as the period; it passes only when it is
// exactly what voucherByMasterRequest builds for one day and 1 to 50 MasterIDs (recorder_live.go). Never a day's list
//
// Round 3 R3-1: the two exceptions are checked by their id, always (whatever ReadDays says, whatever date form they use):
// a FinComVoucherByMaster or FinComSlice that is not exactly as built, with its values in bounds, never goes. And a
// request with its dates only in a TDL filter ($Date compared, $$IsBetween, a $$Date literal) is dated too
func datedRefused(tc *TC, x string) error {
	switch tallyRequestID(x) {
	case vchByMasterID:
		if voucherByMasterExact(x) {
			return nil
		}
		return readsOffErr()
	case sliceID:
		if sliceExact(x) { // source C's month slice in the kept form, its values checked (recorder_probes.go)
			return nil
		}
		return readsOffErr()
	}
	if tc.person || readDaysOn() || !requestDated(x) {
		return nil
	}
	return readsOffErr()
}

var reFilterDate = regexp.MustCompile(`\$Date\b|\$\$IsBetween|\$\$Date:`)

// a request carries a period: SVFROMDATE / SVTODATE, or dates in a TDL filter
func requestDated(x string) bool {
	return strings.Contains(x, "<SVFROMDATE") || strings.Contains(x, "<SVTODATE") || reFilterDate.MatchString(x)
}

// round 18 (item 89, evaluation only): the request body as Tally gets it. TallyRequestUTF16 (default off): UTF-16LE
// with its BOM, Content-Type text/xml;charset=utf-16; else UTF-8 as before
func tallyBody(x string, wide bool) ([]byte, string) {
	if !wide {
		return []byte(x), "text/xml;charset=utf-8"
	}
	u := utf16.Encode([]rune(x))
	b := make([]byte, 2, 2+2*len(u))
	b[0], b[1] = 0xFF, 0xFE
	for _, c := range u {
		b = append(b, byte(c), byte(c>>8))
	}
	return b, "text/xml;charset=utf-16"
}

type encKey struct{}

// the encoding of one request: the request's own (TC.enc, the read test's probe), else the setting
func wantUTF16(ctx context.Context) bool {
	switch e, _ := ctx.Value(encKey{}).(string); e {
	case "utf-16":
		return true
	case "utf-8":
		return false
	}
	return cfgB("TallyRequestUTF16")
}

var fin = &TC{}

// --- the request itself
var (
	errTimeout = errors.New("The operation has timed out")
	// a background read stopped so that FinCom's request (a posting) goes first: not a failure, it resumes from its saved
	// progress
	errPreempted = errors.New("stopped at once so that FinCom's request goes first; it resumes from where it was")
	// a background read while Tally is left alone after a failure: nothing is sent
	errBackoff = errors.New("Tally is left alone for now after it did not answer; nothing was sent")
	// the connection closed before Tally's whole answer came (a message box mid-save, Tally closing)
	errClosed = errors.New("The underlying connection was closed: An unexpected error occurred on a receive.")
)

// Tally took this very request and did not answer it (timed out, or the answer stopped part way): only this counts as
// Tally hanging on a request. A request refused or held here (nothing sent), or stopped for FinCom's, does not
func tallyNoAnswer(err error) bool { return errors.Is(err, errTimeout) || errors.Is(err, errClosed) }

// 2.1.3: no single request may hold Tally longer than this (2.1.5: 20 s, the acceptance limit): a background read is made of small requests instead
// (a batch of ledgers, a few days), each saved as it comes, so a failure never throws the work away
func tallyMaxSec() int { return keepNum("TallyMaxSec", 20) }

// every request actually sent to Tally (the tests count them; nothing is sent while the bridge is idle)
var (
	tallySent   atomic.Int64
	tallySentAt atomic.Int64 // Unix seconds of the last one
)

// now, as the bridge's timers see it (the tests move it on)
var nowFn = time.Now

func tallyRaw(ctx context.Context, port int, x string, timeoutSec int) (string, error) {
	if err := checkAllowed(x); err != nil {
		return "", err
	}
	if timeoutSec <= 0 {
		timeoutSec = toInt(cfg("TallyTimeoutSec"))
		if timeoutSec <= 0 {
			timeoutSec = 120
		}
	}
	if m := tallyMaxSec(); timeoutSec > m && !isImportRequest(x) {
		timeoutSec = m // the read cap (2.1.5: 20 s); an import request keeps its own timeout (importTimeoutSec)
	}
	if ms := toInt(cfg("GentleMs")); ms > 0 {
		select {
		case <-ctx.Done():
			return "", errPreempted
		case <-time.After(time.Duration(ms) * time.Millisecond):
		}
	}
	host := cfgS("TallyHost")
	if host == "" {
		host = "127.0.0.1"
	}
	cl := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second, Transport: &http.Transport{DisableKeepAlives: true, Proxy: nil}}
	body, ctype := tallyBody(x, wantUTF16(ctx))
	req, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("http://%s:%d", host, port), bytes.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	tallySent.Add(1)
	tallySentAt.Store(time.Now().Unix())
	resp, err := cl.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return "", errPreempted
		}
		e := plainNetErr(err)
		noteSilence(e)
		return "", e
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return "", errPreempted
		}
		e := plainNetErr(err)
		noteSilence(e)
		return "", e
	}
	noteSilence(nil)
	return textFromBytes(b), nil
}

// the words Windows uses, which the rest of the bridge (and FinCom) read
func plainNetErr(err error) error {
	var ne net.Error
	s := err.Error()
	switch {
	case errors.As(err, &ne) && ne.Timeout(), strings.Contains(s, "Timeout"), strings.Contains(s, "timeout"):
		return errTimeout
	case strings.Contains(s, "refused"):
		return errors.New("No connection could be made because the target machine actively refused it")
	case strings.Contains(s, "EOF"), strings.Contains(s, "reset"), strings.Contains(s, "closed"), strings.Contains(s, "broken pipe"):
		return errClosed
	}
	return err
}

// --- one request at a time to each Tally; FinCom first, always. 2.1.3: a FinCom request is never refused because the
// bridge is reading in the background (02-Oct-2026 16:13: a posting was refused with "busy with another FinCom
// request" while the bridge's own 900-second read of every opening balance held Tally): the background read is stopped
// at once (its request closed), FinCom's request goes, and the read resumes from its saved progress afterwards
type portGate struct {
	ch      chan struct{}
	mu      sync.Mutex
	copier  bool               // the request at Tally now is a background read
	cancel  context.CancelFunc // stops it
	waiting int                // FinCom requests waiting for this Tally
	posts   int                // postings (an import, its duplicate check) waiting: they go before FinCom's reads
}

var (
	portLocksMu sync.Mutex
	portLocks   = map[int]*portGate{}
	wantMu      sync.Mutex
	wantAt      time.Time
)

func portLock(p int) *portGate {
	portLocksMu.Lock()
	defer portLocksMu.Unlock()
	g, ok := portLocks[p]
	if !ok {
		g = &portGate{ch: make(chan struct{}, 1)}
		portLocks[p] = g
	}
	return g
}
func setWant() {
	wantMu.Lock()
	wantAt = time.Now()
	wantMu.Unlock()
}

// FinCom is waiting for Tally: the copier gives way between its reads while this is fresh. Beside bridge 1.15.0 (test
// mode) its marks count too, so the two bridges do not crowd Tally
func tallyWanted() bool {
	wantMu.Lock()
	w := time.Since(wantAt) < 4*time.Second
	wantMu.Unlock()
	if w {
		return true
	}
	if ps := psSyncDir(); ps != "" {
		if t, ok := mtime(filepath.Join(ps, "tally-want.txt")); ok && time.Since(t) < 4*time.Second {
			return true
		}
	}
	return false
}

// a FinCom request waiting for this Tally, or just made: the background reads wait
func userWaiting(port int) bool {
	g := portLock(port)
	g.mu.Lock()
	w := g.waiting > 0
	g.mu.Unlock()
	return w || tallyWanted()
}

func enterTallyLock(tc *TC, port int, cancel context.CancelFunc, post bool) (func(), error) {
	g := portLock(port)
	if tc.copier {
		// a background read waits while FinCom wants Tally (postings queue ahead of reads), however long that is
		for userWaiting(port) {
			if stopping() {
				return nil, errPreempted
			}
			time.Sleep(200 * time.Millisecond)
		}
		for {
			select {
			case g.ch <- struct{}{}:
			case <-stopCh:
				return nil, errPreempted
			case <-time.After(200 * time.Millisecond):
				continue
			}
			if userWaiting(port) { // FinCom came meanwhile: it goes first
				<-g.ch
				return nil, errPreempted
			}
			break
		}
	} else {
		setWant()
		g.mu.Lock()
		g.waiting++
		if post {
			g.posts++
		}
		g.mu.Unlock()
		defer func() {
			g.mu.Lock()
			g.waiting--
			if post {
				g.posts--
			}
			g.mu.Unlock()
		}()
		t0, told := time.Now(), false
		for got := false; !got; {
			// postings jump the queue: another FinCom request waits while a posting waits
			g.mu.Lock()
			held := !post && g.posts > 0
			g.mu.Unlock()
			if held {
				select {
				case <-stopCh:
					return nil, errors.New("The bridge is stopping; try again in a moment")
				case <-time.After(50 * time.Millisecond):
				}
				continue
			}
			// a background read at Tally now: stopped at once, its request closed
			g.mu.Lock()
			if g.copier && g.cancel != nil {
				g.cancel()
				g.cancel = nil
				if !told {
					told = true
					writeLog(fmt.Sprintf("Tally %d: a background read was stopped at once so FinCom's request goes first; it resumes afterwards from where it was", port))
				}
			}
			g.mu.Unlock()
			select {
			case g.ch <- struct{}{}:
				got = true
			case <-stopCh:
				return nil, errors.New("The bridge is stopping; try again in a moment")
			case <-time.After(100 * time.Millisecond):
			}
		}
		if time.Since(t0) >= 3*time.Second {
			writeLog(fmt.Sprintf("Tally %d: waited %ds for another FinCom request to finish first", port, int(time.Since(t0).Seconds())))
		}
	}
	g.mu.Lock()
	g.copier, g.cancel = tc.copier, cancel
	g.mu.Unlock()
	unlockOther := lockSharedMutex(port) // beside bridge 1.15.0 in the same Windows session: its own lock too
	return func() {
		unlockOther()
		g.mu.Lock()
		g.copier, g.cancel = false, nil
		g.mu.Unlock()
		<-g.ch
	}, nil
}

// --- after a background read failed, Tally is left alone by the background reads for a while (one line in the log,
// nothing sent meanwhile): 1, 2, 4... minutes, at most 30. FinCom's own requests (a posting, Update now) are not held
var (
	bgMu   sync.Mutex
	bgBack = map[int]keepBack{}
)

func bgBackoffUntil(port int) time.Time {
	bgMu.Lock()
	defer bgMu.Unlock()
	if b, ok := bgBack[port]; ok && nowFn().Before(b.until) {
		return b.until
	}
	return time.Time{}
}

// the next back-off for this Tally (one more failure): until when
func setBgBackoff(port int) time.Time {
	bgMu.Lock()
	defer bgMu.Unlock()
	n := bgBack[port].n + 1
	w := math.Min(1800, float64(keepNum("KeepBackoffSec", 60))*math.Pow(2, float64(n-1)))
	until := nowFn().Add(time.Duration(w) * time.Second)
	bgBack[port] = keepBack{n, until}
	return until
}
func clearBgBackoff(port int) {
	bgMu.Lock()
	delete(bgBack, port)
	bgMu.Unlock()
}

// A Tally that did not answer in time is still working on that request, so it is not asked again for a while: 10 s,
// then 20, 40, 80, at most 2 minutes
type cool struct {
	n     int
	until time.Time
}

var (
	coolMu    sync.Mutex
	tallyCool = map[int]cool{}
)

// --- a Tally busy with a long report, a message box or another user's work: still open, only slow to answer. It is
// reported as "busy" (never as closed or offline), its companies are kept, and it is asked again quietly
var (
	busyMu    sync.Mutex
	inflight  = map[int]time.Time{} // a request at Tally since
	busySince = map[int]time.Time{} // the first time this busy spell was noticed
)

func setInflight(port int, on bool) {
	busyMu.Lock()
	defer busyMu.Unlock()
	if on {
		inflight[port] = time.Now()
	} else {
		delete(inflight, port)
	}
}

// busy: a request has been at Tally for more than TallyBusySec (8) seconds, or Tally did not answer one lately
func tallyBusy(port int) (bool, time.Time) {
	busyMu.Lock()
	t, at := inflight[port]
	since, was := busySince[port]
	busyMu.Unlock()
	coolMu.Lock()
	c, cooling := tallyCool[port]
	coolMu.Unlock()
	busy := (at && time.Since(t) > time.Duration(keepNum("TallyBusySec", 8))*time.Second) || (cooling && time.Now().Before(c.until)) || needProbe(port)
	if !busy {
		return false, time.Time{}
	}
	if !was {
		since = t
		if since.IsZero() || !at {
			since = time.Now()
		}
	}
	return true, since
}

// one of open / busy / closed, for the heartbeat, FinCom's status and the tray
func tallyState(port int) string {
	if !tallyRunning() || !tallyPortOpen(port) {
		return "closed"
	}
	if b, _ := tallyBusy(port); b {
		return "busy"
	}
	if o := readObjFile(stuckFile()); o != nil && toInt(o["port"]) == port {
		return "busy" // its last requests were not answered, and none since
	}
	return "open"
}
func isBusyErr(err error) bool {
	return err != nil && re(`timed out|is busy|was closed|unexpected error occurred on a receive|forcibly closed`).MatchString(err.Error())
}

func invokeTally(tc *TC, port int, x string, timeoutSec int) (string, error) {
	// plan item 7: a request not on the allow-list is refused before anything is sent (allowlist.go)
	if err := checkAllowed(x); err != nil {
		writeLog(fmt.Sprintf("Tally %d: refused: %s", port, err.Error()))
		return "", err
	}
	if err := datedRefused(tc, x); err != nil {
		writeLog(fmt.Sprintf("Tally %d: %s refused before sending: it carries a period and reading old entries is off (ReadDays)", port, tallyRequestID(x)))
		return "", err
	}
	// plan items 10-11: while reading is stopped on this computer only what a posting needs goes (selfwatch.go)
	if err := readStopRefuses(x); err != nil {
		return "", err
	}
	if tc.copier && !bgBackoffUntil(port).IsZero() {
		return "", errBackoff
	}
	// after a request that did not answer, nothing goes before the "is it free?" check may be sent (once a minute)
	if err := probeHold(port); err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if tc.enc != "" {
		ctx = context.WithValue(ctx, encKey{}, tc.enc)
	}
	unlock, err := enterTallyLock(tc, port, cancel, isPostingRequest(x))
	if err != nil {
		return "", err
	}
	if tc.copier && !bgBackoffUntil(port).IsZero() {
		unlock()
		return "", errBackoff
	}
	if tc.yield != nil && tc.yield() {
		unlock()
		return "", errBackoff
	}
	// 2.1.4 (02-Oct-2026, rebuilt): a Tally that did not answer keeps working on that request. Nothing else is sent
	// until a tiny company-level request (the company's name and GUID) has answered; that check goes at most once a
	// minute (TallyProbeEverySec, 60) and is the only request until it answers
	if needProbe(port) {
		co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
		praw, perr := freeProbe(ctx, port, co)
		if perr != nil {
			unlock()
			return "", perr
		}
		if x == companyCheckRequest(co) {
			// the request was the small check itself: its answer is the check's, not sent twice
			unlock()
			return praw, nil
		}
	}
	t0 := time.Now()
	setInflight(port, true)
	r, err := tallyRaw(ctx, port, x, timeoutSec)
	setInflight(port, false)
	if tc.timed != nil && !errors.Is(err, errPreempted) {
		tc.timed(time.Since(t0).Seconds())
	}
	fail := ""
	if errors.Is(err, errPreempted) {
		// stopped for FinCom's request: not Tally's fault, nothing to note
		unlock()
		return "", errPreempted
	}
	if err == nil {
		clearProbe(port)
		busyMu.Lock()
		since, was := busySince[port]
		delete(busySince, port)
		busyMu.Unlock()
		if was {
			writeLog(fmt.Sprintf("Tally %d answers again (it was busy for %s)", port, time.Since(since).Round(time.Second)))
		}
		clearTallyStuck(port)
		// something was posted to Tally: the posted entries go into the copy (and the cloud) once the posting is done
		if !tc.copier && !tc.bench && isImportRequest(x) {
			afterPosting(html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)))
			// a ledger master posted (a new ledger): its list is read once the posting is done (events.go)
			if re(`<LEDGER\b`).MatchString(x) {
				afterPostingLedger(html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)))
			}
		}
	} else {
		fail = err.Error()
		if re(`timed out|was closed|unexpected error occurred on a receive|forcibly closed`).MatchString(fail) {
			setProbeAfterTimeout(port)
			setTallyStuck(port)
			// said once a busy spell; the next tries are quiet
			busyMu.Lock()
			_, was := busySince[port]
			if !was {
				busySince[port] = t0
			}
			busyMu.Unlock()
			if !was {
				writeLog(fmt.Sprintf("Tally %d is busy (no answer in %ds); nothing more is sent to it until it answers a small check (the company's name), asked once a minute", port, int(time.Since(t0).Seconds())))
			}
		}
	}
	if !tc.copier {
		setWant()
	}
	unlock()
	noteRequest(x, time.Since(t0), fail)
	sec := time.Since(t0).Seconds()
	addTallyUse(tc, port, sec, x, fail)
	return r, err
}

// --- "Tally not responding since HH:MM": kept in a file FinCom's status sees
func stuckFile() string { return filepath.Join(syncDir(), "tally-stuck.json") }
func setTallyStuck(port int) {
	o := readObjFile(stuckFile())
	since := nowS()
	// 2.1.3: the bridge asks Tally only after an event, so failures may be hours apart: "since" stays until Tally answers
	if o != nil && toInt(o["port"]) == port && str(o["since"]) != "" {
		since = str(o["since"])
	}
	_ = saveFile(stuckFile(), jsonText(M{"port": port, "since": since, "last": nowS()}))
}

// since when Tally has not answered (its last requests failed, none answered since), for the heartbeat and FinCom's
// "Tally is not answering on NWS144 since 12:28"; "" when it answers, or when Tally is closed (that is said instead)
func notAnsweringSince() string {
	o := readObjFile(stuckFile())
	if o == nil || str(o["since"]) == "" {
		return ""
	}
	if !tallyRunning() || !tallyPortOpen(toInt(o["port"])) {
		return ""
	}
	return str(o["since"])
}
func clearTallyStuck(port int) {
	o := readObjFile(stuckFile())
	if o != nil && toInt(o["port"]) == port {
		_ = os.Remove(stuckFile())
	}
}
func getTallyStuck() any {
	o := readObjFile(stuckFile())
	if o == nil {
		return nil
	}
	if l, ok := parseTime(str(o["last"])); ok && time.Since(l) < 10*time.Minute {
		return o
	}
	return nil
}

// --- Tally's time used by the copier (its share is kept small) and what each kind of request costs
type use struct {
	at  time.Time
	sec float64
}
type stat struct {
	port     int
	kind     string
	n, fail  int
	sec, max float64
}

var (
	useMu      sync.Mutex
	tallyUse   = map[int][]use{}
	tallyStats = map[string]*stat{}
)

func reqKind(x string) string {
	if m := group(`<ID>([^<]+)</ID>`, x, 1); m != "" {
		return m
	}
	if m := group(`<REPORTNAME>([^<]+)</REPORTNAME>`, x, 1); m != "" {
		return m
	}
	if strings.Contains(x, "Import Data") {
		return "Posting"
	}
	return "Other"
}
func addTallyUse(tc *TC, port int, sec float64, x, fail string) {
	kind := reqKind(x)
	if tc.copier {
		useMu.Lock()
		now := time.Now()
		u := append(tallyUse[port], use{now, sec})
		for len(u) > 0 && now.Sub(u[0].at) > 300*time.Second {
			u = u[1:]
		}
		tallyUse[port] = u
		k := fmt.Sprintf("%d %s", port, kind)
		t := tallyStats[k]
		if t == nil {
			t = &stat{port: port, kind: kind}
			tallyStats[k] = t
		}
		t.n++
		t.sec += sec
		if sec > t.max {
			t.max = sec
		}
		if fail != "" {
			t.fail++
		}
		useMu.Unlock()
	}
	quiet := false
	if fail != "" && (re(`is busy and did not answer the last request`).MatchString(fail) || fail == errBackoff.Error() || fail == errPreempted.Error()) {
		quiet = true // a quiet retry while Tally is busy
	}
	if !quiet && (fail != "" || sec >= float64(keepNum("KeepSlowSec", 3))) {
		f, to := requestFrom(x)
		span := ""
		if f != "" {
			span = " " + f
			if to != "" && to != f {
				span += "-" + to
			}
		}
		msg := fmt.Sprintf("Tally %d: %s%s took %.1fs", port, kind, span, sec)
		if fail != "" {
			msg += " and failed: " + fail
		}
		writeLog(msg)
	}
}

// the copier's share of one Tally's time in the last minute (0..1)
func tallyShare(port int) float64 {
	useMu.Lock()
	defer useMu.Unlock()
	sum := 0.0
	for _, u := range tallyUse[port] {
		if time.Since(u.at).Seconds() <= 60 {
			sum += u.sec
		}
	}
	if sum/60 > 1 {
		return 1
	}
	return sum / 60
}

// --- the "is Tally free?" check (2.1.4, rebuilt 02-Oct-2026). Tally keeps working on a request after the bridge gives up
// on it, so after a request that did not answer nothing is sent until one tiny company-level request has answered: the
// company's name and GUID (FinComCompany; the company list when no company is named). It goes at most once every
// TallyProbeEverySec (60) seconds; meanwhile every request is refused at once without anything being sent (a posting
// waits: "Waiting for Tally: Tally is busy")
type probeState struct {
	need bool
	last time.Time // the request that did not answer, or the last check sent
}

var (
	probeMu   sync.Mutex
	probes    = map[int]*probeState{}
	probeSent atomic.Int64
)

func probeEvery() time.Duration {
	return time.Duration(keepNum("TallyProbeEverySec", 60)) * time.Second
}
func setProbeAfterTimeout(port int) {
	probeMu.Lock()
	probes[port] = &probeState{true, nowFn()}
	probeMu.Unlock()
}
func clearProbe(port int) {
	probeMu.Lock()
	delete(probes, port)
	probeMu.Unlock()
}
func needProbe(port int) bool {
	probeMu.Lock()
	defer probeMu.Unlock()
	p := probes[port]
	return p != nil && p.need
}

// a request while Tally has not answered: refused at once (nothing sent) until the next check may go
func probeHold(port int) error {
	probeMu.Lock()
	defer probeMu.Unlock()
	p := probes[port]
	if p == nil || !p.need {
		return nil
	}
	if next := p.last.Add(probeEvery()); nowFn().Before(next) {
		return fmt.Errorf("Tally (port %d) is busy: it did not answer a request and may still be working on it; nothing is sent until it answers a small check (next at %s)", port, next.Format("15:04:05"))
	}
	return nil
}

// the company-level check: the company's name and GUID (Tally's own list of loaded companies, filtered to it)
func companyCheckRequest(company string) string {
	if company == "" {
		return collectionRequest("FinComFree", "Company", "NAME,GUID", "", "")
	}
	return fcCollection("FinComCompany", company, "", "Company", "NAME, GUID, ALTVCHID, ALTMSTID", `$Name = "`+strings.ReplaceAll(company, `"`, "")+`"`)
}

func freeProbe(ctx context.Context, port int, company string) (string, error) {
	probeMu.Lock()
	if p := probes[port]; p != nil {
		if nowFn().Before(p.last.Add(probeEvery())) {
			probeMu.Unlock()
			return "", fmt.Errorf("Tally (port %d) is busy: it did not answer a request; nothing is sent until it answers a small check", port)
		}
		p.last = nowFn()
	}
	probeMu.Unlock()
	probeSent.Add(1)
	raw, err := tallyRaw(ctx, port, companyCheckRequest(company), keepNum("TallyProbeSec", 10))
	if err == nil {
		clearProbe(port)
		if company != "" {
			noteCompanyGUID(company, group(`<GUID[^>]*>([^<]*)</GUID>`, raw, 1))
			noteCompanyAlts(company, raw)
		}
		writeLog(fmt.Sprintf("Tally %d answered the small check; requests go again", port))
		return raw, nil
	}
	if errors.Is(err, errPreempted) {
		return "", errPreempted
	}
	return "", fmt.Errorf("Tally (port %d) is busy: it is still working on an earlier request and did not answer the small check; nothing else was sent (asked again in a minute)", port)
}

// a posting (an import) or the reads that belong to it (the duplicate check, the look for a FinCom id): these go
// before any other request waiting for the same Tally
func isPostingRequest(x string) bool {
	if isImportRequest(x) {
		return true
	}
	id := group(`<ID>([^<]+)</ID>`, x, 1)
	return id == dupCheckID || id == tagCheckID || id == "FinComCompany"
}
