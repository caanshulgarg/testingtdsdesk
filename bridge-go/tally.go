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
	d := xml.NewDecoder(strings.NewReader(cleanXML(dropCmpInfo(text)))) // never a CMPINFO counter as an object (tallyxml.go)
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
	// next-inflight: where invokeTallyNow puts the request it gave up on while Tally is still on it (only invokeTally's own
	// copy of a TC carries it: a shared TC never does)
	slotOut **abandonSlot
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
	// 2.2.2 (the owner's condition b): a HARD stop for the recorder's background reads (the entry fetch by MasterID and by
	// number, source B, source C, the held resolver; 2.3.1: the company list asked in the background, bgCompaniesTC): the
	// bridge stops waiting after this many milliseconds (a context deadline from the send). Never for a posting (Import), a
	// person's read or the light company check FinComCompany (they never set it)
	limitMs int
	// 2.2.2 second review (L-B): the light company check and the open-company list (tiny): not held by the cool-down after
	// a recorder read's stop (the probe and busy rules still apply)
	light bool
	// 2.3.1 (the owner's last change, retry.go): a background request (the entry fetch, the company list asked in the
	// background, the ledger changes, the light check, the held-line resolve): it waits for the shared retry schedule after
	// a stop or no answer, and its answer in time ends it. Never a posting or a person's request
	bg bool
	// the shared retry schedule's try itself (set by invokeTally on its own copy of the TC)
	isTry bool
}

// round 19 (review finding 1, the owner's rule "reading is prospective only", by any route): a request carrying a period
// (SVFROMDATE / SVTODATE, any date form) goes to Tally only when ReadDays is on or a person started it
//
// 2.2.0 (the owner's rule, prospective only): one narrow exception, the recorder's body fetch (FinComVoucherByMaster):
// it asks only the entries just changed, by MasterID, with the line's own date as the period; it passes only when it is
// exactly what voucherByMasterRequest builds for one day and exactly one MasterID (2.3.1; recorder_live.go). Never a day's list
//
// Round 3 R3-1: the two exceptions are checked by their id, always (whatever ReadDays says, whatever date form they use):
// a FinComVoucherByMaster or FinComSlice that is not exactly as built, with its values in bounds, never goes.
// Round 4 R4-1: with ReadDays off the guard decides by the request's id, not by how its dates are spelt: an id that
// reads by date is refused; TDSDeskKeepList goes only exactly as keepListAboveRequest builds it (its undated form); an
// undated id goes unless it carries dates in any spelling (a normalised copy, lower-cased with character references
// decoded, is looked at too). Import is a posting, not a read
var requestClass = map[string]string{
	"Day Book": "dated", "TDSDeskVchHeads": "dated", dupCheckID: "dated", tagCheckID: "dated", masterCheckID: "dated",
	"FinComMeasureB": "dated", "FinComMeasureC": "dated", "FinComMeasureYear": "dated", "FinComMeasureD": "dated",
	"FinComMeasureE": "dated", "FinComSnapshot": "dated", datesProbeID: "dated",
	vchByMasterID: "exception", sliceID: "exception", vchByNumberID: "exception",
	"TDSDeskKeepList":  "keepAbove",
	"Import":           "import",
	"TDSDeskCompanies": "undated", "TDSDeskCompanyInfo": "undated", "FinComCompany": "undated", "FinComFree": "undated",
	ledListID: "undated", grpListID: "undated", "TDSDeskLedgers": "undated", "TDSDeskGroups": "undated", "TDSDeskNames": "undated",
	"TDSDeskGroupNames": "undated", "FinComMeasureNames": "undated", "FinComMeasureLedF": "undated", "FinComMeasureLedO": "undated",
	editLogProbeID: "undated", cnReportID: "undated",
	ledChangesID: "undated", ledByNameID: "undated", // 2.3.1 (masters): no period, ever
	// 2.2.3: "Test fetching an entry" (measure-only, a person's): its dated forms and its undated ones
	fetchTestA: "dated", fetchTestB: "dated", fetchTestC: "dated", fetchTestE: "dated", fetchTestD: "undated", fetchTestF: "undated",
}

func datedRefused(tc *TC, x string) error {
	id := tallyRequestID(x)
	switch id {
	case vchByMasterID:
		if voucherByMasterExact(x) {
			return nil
		}
		return readsOffErr()
	case vchByNumberID:
		// 2.2.1: a new entry by its type and number, one day, exactly as built, its values checked (recorder_resolve.go)
		if voucherByNumberExact(x) {
			return nil
		}
		return readsOffErr()
	case sliceID:
		if sliceExact(x) { // source C's month slice in the kept form, its values checked (recorder_probes.go)
			return nil
		}
		return readsOffErr()
	case "TDSDeskKeepList":
		// round 5 R5-1: the undated list above an AlterID always needs the starting point (whoever asks)
		if !requestDated(x) {
			if keepAboveExact(x) {
				return nil
			}
			return readsOffErr()
		}
	}
	if tc.person || readDaysOn() {
		return nil
	}
	switch requestClass[id] {
	case "import":
		return nil
	case "keepAbove":
		if keepAboveExact(x) {
			return nil
		}
	case "undated":
		if !requestDated(x) {
			return nil
		}
	}
	return readsOffErr() // dated, or not classified
}

// TDSDeskKeepList exactly as keepListAboveRequest builds it, rebuilt from its company and AlterID
func keepAboveExact(x string) bool {
	m := regexp.MustCompile(`\$AlterID &gt; (\d+)`).FindStringSubmatch(x)
	if m == nil {
		return false
	}
	co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
	// round 5 R5-1: only from the company's starting point on (no starting point: never; a lower AlterID would be a full
	// read of everything changed since)
	sp, ok := startPointOf(co)
	return ok && toI64(m[1]) >= sp && x == keepListAboveRequest(co, toI64(m[1]))
}

var reFilterDate = regexp.MustCompile(`\$date\b|\$\$isbetween|\$\$date:|<svfromdate|<svtodate`)

// a request carries a period, in any spelling: SVFROMDATE / SVTODATE, or dates in a TDL filter; looked for in a
// normalised copy (lower-cased, XML character references decoded, the company's name left out)
func requestDated(x string) bool {
	y := regexp.MustCompile(`(?is)<SVCURRENTCOMPANY>[^<]*</SVCURRENTCOMPANY>`).ReplaceAllString(x, "")
	n := strings.ToLower(html.UnescapeString(y))
	return reFilterDate.MatchString(n) || reFilterDate.MatchString(strings.ToLower(y))
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
	// 2.2.2: a recorder read stopped at its hard limit (TC.limitMs)
	errRecorderStop = errors.New("Tally took longer than the recorder's limit; the bridge stopped waiting")
)

// 2.2.2: the context values of one request: the recorder's hard stop (a time.Duration from the send), and where the send
// time is noted (*time.Time)
type stopKey struct{}
type sentKey struct{}

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
	parent := ctx
	if d, _ := ctx.Value(stopKey{}).(time.Duration); d > 0 {
		var stop context.CancelFunc
		ctx, stop = context.WithTimeout(ctx, d)
		defer stop()
	}
	// a deliberate stop (the caller's deadline): not Tally's silence, never noted as such
	stoppedHere := func() bool { return parent.Err() == nil && errors.Is(ctx.Err(), context.DeadlineExceeded) }
	// 2.3.1 (one request in flight per Tally, inflight.go): the exchange itself runs on its own, bounded only by
	// TallyAbandonMaxSec; the caller waits for it until its timeout, its stop or its cancel. Given up, the connection is
	// not closed: Tally is still on it, so its answer is read and discarded, and the caller's lock is held until then
	// next-inflight: TallyAbandonMaxSec counts from the moment the bridge stopped waiting (an import's own long timeout
	// is never cut by it)
	xctx, xdone := context.WithCancel(context.Background())
	var bounded atomic.Bool
	cl := &http.Client{Transport: &http.Transport{DisableKeepAlives: true, Proxy: nil}}
	body, ctype := tallyBody(x, wantUTF16(ctx))
	req, _ := http.NewRequestWithContext(xctx, "POST", fmt.Sprintf("http://%s:%d", host, port), bytes.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	tallySent.Add(1)
	tallySentAt.Store(time.Now().Unix())
	if at, _ := ctx.Value(sentKey{}).(*time.Time); at != nil {
		*at = time.Now()
	}
	type answer struct {
		b   []byte
		err error
	}
	got := make(chan answer, 1)
	go func() {
		defer xdone()
		resp, err := cl.Do(req)
		if err != nil {
			if bounded.Load() {
				err = errTimeout
			}
			got <- answer{nil, err}
			return
		}
		b, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil && bounded.Load() {
			err = errTimeout
		}
		got <- answer{b, err}
	}()
	wait := time.NewTimer(time.Duration(timeoutSec) * time.Second)
	defer wait.Stop()
	var why error
	select {
	case a := <-got:
		if a.err != nil {
			return "", plainNetErr(a.err)
		}
		return textFromBytes(a.b), nil
	case <-ctx.Done():
		if stoppedHere() {
			why = fmt.Errorf("%w (%g s)", errRecorderStop, ctx.Value(stopKey{}).(time.Duration).Seconds())
		} else {
			why = errPreempted
		}
	case <-wait.C:
		why = errTimeout
	}
	// TallyAbandonMaxSec 0: the request is closed now (as before); invokeTallyNow owes the small check after a minute
	if abandonMax() <= 0 {
		xdone()
		<-got
		return "", why
	}
	// given up: Tally is still on it. The answer is read in the background and discarded; the lock goes when it ends
	id, t0, gaveUp := tallyRequestID(x), time.Now(), nowFn()
	done := make(chan struct{})
	slot, _ := parent.Value(abandonKey{}).(*abandonSlot)
	if slot == nil {
		slot = &abandonSlot{}
	}
	slot.done, slot.id, slot.at = done, id, t0
	bound := time.AfterFunc(abandonMax(), func() { bounded.Store(true); xdone() })
	go func() {
		defer close(done)
		a := <-got
		bound.Stop()
		if errors.Is(a.err, errTimeout) && bounded.Load() {
			// next-inflight: the long bound. The bridge closes the connection; whether Tally is free is not known, so the
			// small check goes first, at once (setProbeNow: no minute's wait, nothing was sent since), and the request
			// after it when Tally answers it
			slot.bound = true
			writeLog(fmt.Sprintf("Tally %d did not answer an earlier request (%s, sent at %s) in %s: taken as not answering; the next request may go (the small check first)",
				port, id, t0.Format("15:04:05"), abandonMax().Round(time.Second)))
			setProbeFrom(port, gaveUp)
			setTallyStuck(port)
			return
		}
		// next-inflight: Tally finished it (answered, or closed it): Tally is free, no small check is owed. Within the 20 s wait
		// after the stop the next request goes at once (invokeTally lifts the retry schedule's wait); later, the schedule stands
		slot.took = time.Since(t0)
		clearProbe(port)
		clearTallyStuck(port)
		if slot.took <= abandonWait() {
			writeLog(fmt.Sprintf("Tally %d finished the request the bridge stopped waiting for (%s) %s after the stop; its answer is discarded and the next request goes now",
				port, id, slot.took.Round(100*time.Millisecond)))
		} else {
			writeLog(fmt.Sprintf("Tally %d answered the earlier request (%s) %s after the bridge stopped waiting (over the %s wait); its answer is discarded and the next request goes at the retry schedule's time",
				port, id, slot.took.Round(100*time.Millisecond), abandonWait().Round(time.Second)))
		}
	}()
	return "", why
}

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
				// 2.3.1: Tally still on an earlier request given up: not waited for here (the retry schedule)
				if err := earlierRefusal(port); err != nil && !tc.person {
					return nil, err
				}
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
		t0, told, toldEarlier := time.Now(), false, false
		for got := false; !got; {
			// 2.3.1 (inflight.go): Tally still on an earlier request the bridge stopped waiting for: this one waits, said once
			if e := earlierRefusal(port); e != nil {
				s := e.(*earlierErr).s
				if !toldEarlier {
					toldEarlier = true
					writeLog(fmt.Sprintf("Tally %d: %s (%s, sent at %s); this one goes when Tally has answered it", port, earlierWords, s.id, s.at.Format("15:04:05")))
				}
				// next-inflight: a person's read waits up to TallyAbandonWaitSec (20 s), then backs off in plain words, nothing
				// sent; a posting waits on (it says so, and is never lost)
				if !post && time.Since(t0) >= abandonWait() {
					return nil, fmt.Errorf("Tally (port %d) is still working on an earlier request (%s, sent at %s); nothing was sent (%s), try again in a moment", port, s.id, s.at.Format("15:04:05"), earlierWords)
				}
			}
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

// 2.2.2 review (M3): after the recorder's hard stop the background reads (not a person's) leave Tally alone a while
var stopHold = map[int]time.Time{}

func stopHeld(port int) bool {
	bgMu.Lock()
	defer bgMu.Unlock()
	return nowFn().Before(stopHold[port])
}

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
	if !tc.bg || tc.person || isImportRequest(x) || checkAllowed(x) != nil || readStopRefuses(x) != nil {
		return invokeTallyNow(tc, port, x, timeoutSec)
	}
	// 2.3.1: a background request waits for the shared retry schedule (retry.go); nothing is sent before its time
	try, err := retryTake()
	if err != nil {
		return "", err
	}
	t2 := *tc
	t2.isTry = try
	var given *abandonSlot
	t2.slotOut = &given
	r, err := invokeTallyNow(&t2, port, x, timeoutSec)
	retryNote(port, tallyRequestID(x), err)
	// next-inflight (the owner, 07-Oct-2026): after a stop the bridge waits up to TallyAbandonWaitSec (20 s) for Tally to
	// finish that request, sending nothing; finished in time, the retry schedule's wait is lifted and the next request
	// goes at once; not finished, the schedule's back-off stands
	if s := given; s != nil && s.done != nil && err != nil {
		go func() {
			select {
			case <-s.done:
				if !s.bound && s.took <= abandonWait() {
					retryLift()
				}
			case <-time.After(abandonWait() + time.Second):
			}
		}()
	}
	return r, err
}

func invokeTallyNow(tc *TC, port int, x string, timeoutSec int) (string, error) {
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
	// (a background request of 2.3.1 follows the shared retry schedule instead: invokeTally)
	if tc.copier && !tc.bg && !bgBackoffUntil(port).IsZero() {
		return "", errBackoff
	}
	if tc.copier && !tc.bg && !tc.person && !tc.light && stopHeld(port) {
		return "", errBackoff // 2.2.2: a recorder read was stopped at its limit: Tally is still on it
	}
	// after a request that did not answer, nothing goes before the "is it free?" check may be sent (once a minute)
	if err := probeHold(port); err != nil {
		return "", err
	}
	// decision D (05-Oct-2026): a background read of a company whose lease this bridge holds for reading gives way, here
	// at the request boundary (before the next request, never cutting one), when another bridge wants to post to it
	if tc.copier && !tc.light && !isImportRequest(x) {
		if co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)); co != "" && leaseYieldNow(co) {
			return "", errPreempted
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if tc.enc != "" {
		ctx = context.WithValue(ctx, encKey{}, tc.enc)
	}
	// 2.3.1 (inflight.go): a background read is not sent into a Tally still on an earlier request it was given up on
	if tc.copier && !tc.person {
		if err := earlierRefusal(port); err != nil {
			return "", err
		}
	}
	unlock0, err := enterTallyLock(tc, port, cancel, isPostingRequest(x))
	if err != nil {
		return "", err
	}
	// 2.3.1: a request given up while Tally is still on it keeps the lock until Tally answered or closed it
	slot := &abandonSlot{}
	ctx = context.WithValue(ctx, abandonKey{}, slot)
	unlock := func() {
		if slot.done != nil {
			holdUntilAnswered(port, slot, unlock0)
			return
		}
		unlock0()
	}
	if tc.copier && !tc.bg && !bgBackoffUntil(port).IsZero() {
		unlock()
		return "", errBackoff
	}
	if tc.yield != nil && tc.yield() {
		unlock()
		return "", errBackoff
	}
	// 2.3.1 (as 2.2.2's L-A): a background request that waited for the lock while another was stopped or not answered is
	// not sent: it waits for the retry schedule's try
	if tc.bg && !tc.isTry {
		if err := retryWaiting(); err != nil {
			unlock()
			return "", err
		}
	}
	// 2.2.2 second review (L-A): a background read that waited for the lock while a recorder read was stopped is not
	// sent into the Tally still working on it
	if tc.copier && !tc.bg && !tc.person && !tc.light && stopHeld(port) {
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
	// 2.2.2: the recorder's hard stop, counted from the send itself (after any gentle wait: tallyRaw starts it)
	stopAt := time.Duration(0)
	if tc.limitMs > 0 && tc.copier && !tc.person && !isImportRequest(x) && !isPostingRequest(x) {
		stopAt = time.Duration(tc.limitMs) * time.Millisecond
		ctx = context.WithValue(ctx, stopKey{}, stopAt)
	}
	sentAt := new(time.Time)
	ctx = context.WithValue(ctx, sentKey{}, sentAt)
	t0 := time.Now()
	setInflight(port, true)
	r, err := tallyRaw(ctx, port, x, timeoutSec)
	// next-inflight: a request given up is held as in flight (the lock kept) until Tally finishes it; its end decides the
	// small check (none when Tally finished it; first, after the long bound) and, within the 20 s wait, lifts the retry wait
	held := slot.done != nil
	if tc.slotOut != nil {
		*tc.slotOut = slot
	}
	setInflight(port, false)
	took := time.Since(t0)
	if !sentAt.IsZero() {
		took = time.Since(*sentAt) // the time Tally had the request (a gentle wait is not Tally's)
	}
	stopped := errors.Is(err, errRecorderStop)
	if stopped {
		// the hard stop: Tally is still working on the request. The background reads leave it alone for a while
		// (RecorderStopCoolSec, 30 s: nothing more is sent into it); FinCom's postings and a person's reads are not held,
		// and it is not Tally's silence (selfwatch) nor a busy spell
		if took <= stopAt {
			took = stopAt + time.Millisecond // the caller's 2 s rule always sees a stop as over the limit
		}
		bgMu.Lock()
		stopHold[port] = nowFn().Add(time.Duration(keepNum("RecorderStopCoolSec", 30)) * time.Second)
		bgMu.Unlock()
	}
	if tc.timed != nil && !errors.Is(err, errPreempted) {
		tc.timed(took.Seconds())
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
			// next-inflight: a request held as in flight (Tally still on it) owes no small check here: its end decides
			// (finished: none; the long bound: the check first). One Tally closed is checked as before
			if !held {
				setProbeAfterTimeout(port)
			}
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
	// 2.2.0 (the owner's finding on NWS144): AltVchId and AltMstId are Company methods, not stored fields; a FETCH of them
	// gave the company with empty tags. They are asked as NATIVEMETHODs (form a); the report form b is in safety.go
	return fcCollection("FinComCompany", company, "", "Company", "NAME, GUID</FETCH><NATIVEMETHOD>AltVchId</NATIVEMETHOD><NATIVEMETHOD>AltMstId</NATIVEMETHOD><FETCH>NAME", `$Name = "`+strings.ReplaceAll(company, `"`, "")+`"`)
}

// form b: a small report over the one company (by $Name), two fields SET to $AltVchId and $AltMstId (method reads of
// the company object; no $$ function but the export format), with its name and GUID
const cnReportID = "FinComCompanyNumbers"

func companyNumbersRequest(company string) string {
	co := esc(company)
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>" + cnReportID + "</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + co + "</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<REPORT NAME="` + cnReportID + `" ISMODIFY="No"><FORMS>FinComCNForm</FORMS></REPORT>` +
		`<FORM NAME="FinComCNForm" ISMODIFY="No"><PARTS>FinComCNPart</PARTS><XMLTAG>FINCOMNUMBERS</XMLTAG></FORM>` +
		`<PART NAME="FinComCNPart" ISMODIFY="No"><LINES>FinComCNLine</LINES><REPEAT>FinComCNLine : FinComCNCos</REPEAT><SCROLLED>Vertical</SCROLLED></PART>` +
		`<LINE NAME="FinComCNLine" ISMODIFY="No"><FIELDS>FinComCNName, FinComCNGuid, FinComCNVch, FinComCNMst</FIELDS><XMLTAG>COMPANY</XMLTAG></LINE>` +
		`<FIELD NAME="FinComCNName" ISMODIFY="No"><SET>$Name</SET><XMLTAG>NAME</XMLTAG></FIELD>` +
		`<FIELD NAME="FinComCNGuid" ISMODIFY="No"><SET>$Guid</SET><XMLTAG>GUID</XMLTAG></FIELD>` +
		`<FIELD NAME="FinComCNVch" ISMODIFY="No"><SET>$AltVchId</SET><XMLTAG>ALTVCHID</XMLTAG></FIELD>` +
		`<FIELD NAME="FinComCNMst" ISMODIFY="No"><SET>$AltMstId</SET><XMLTAG>ALTMSTID</XMLTAG></FIELD>` +
		`<COLLECTION NAME="FinComCNCos" ISMODIFY="No"><TYPE>Company</TYPE><FILTERS>FinComCNOnly</FILTERS></COLLECTION>` +
		`<SYSTEM TYPE="Formulae" NAME="FinComCNOnly">` + esc(`$Name = "`+strings.ReplaceAll(company, `"`, "")+`"`) + `</SYSTEM>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
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
			noteCompanyGUID(company, tagRaw(raw, "GUID"))
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
