// Talking to Tally: one request at a time to each Tally, FinCom's requests before the routine copy, a Tally that did not
// answer left alone for a while, and every request timed (bridge 1.14.x rules, keep.ps1 and the base script).
package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
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
	return string(b)
}
func utf16le(b []byte) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return string(utf16.Decode(u))
}

// Tally sometimes sends characters that are not allowed in XML (ConvertTo-CleanXml)
func cleanXML(t string) string {
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

// --- who asks: FinCom (a person waiting) or the copier (the routine copy, which gives way)
type TC struct {
	copier  bool
	readSec int // the copier: no read of the day book may hold Tally longer than this
}

var fin = &TC{}

// --- the request itself
var errTimeout = errors.New("The operation has timed out")

func tallyRaw(port int, x string, timeoutSec int) (string, error) {
	if timeoutSec <= 0 {
		timeoutSec = toInt(cfg("TallyTimeoutSec"))
		if timeoutSec <= 0 {
			timeoutSec = 120
		}
	}
	if ms := toInt(cfg("GentleMs")); ms > 0 {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	}
	host := cfgS("TallyHost")
	if host == "" {
		host = "127.0.0.1"
	}
	cl := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second, Transport: &http.Transport{DisableKeepAlives: true, Proxy: nil}}
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://%s:%d", host, port), strings.NewReader(x))
	req.Header.Set("Content-Type", "text/xml;charset=utf-8")
	resp, err := cl.Do(req)
	if err != nil {
		return "", plainNetErr(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", plainNetErr(err)
	}
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
		return errors.New("The underlying connection was closed: An unexpected error occurred on a receive.")
	}
	return err
}

// --- one request at a time to each Tally; FinCom first
var (
	portLocksMu sync.Mutex
	portLocks   = map[int]chan struct{}{}
	wantMu      sync.Mutex
	wantAt      time.Time
)

func portLock(p int) chan struct{} {
	portLocksMu.Lock()
	defer portLocksMu.Unlock()
	c, ok := portLocks[p]
	if !ok {
		c = make(chan struct{}, 1)
		portLocks[p] = c
	}
	return c
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

func enterTallyLock(tc *TC, port, waitSec int) (func(), error) {
	if tc.copier {
		t0 := time.Now()
		for tallyWanted() && time.Since(t0) < 180*time.Second {
			time.Sleep(500 * time.Millisecond)
		}
	} else {
		setWant()
	}
	c := portLock(port)
	t0 := time.Now()
	select {
	case c <- struct{}{}:
	case <-time.After(time.Duration(maxI(1, waitSec)) * time.Second):
		return nil, fmt.Errorf("Tally (port %d) is busy with another FinCom request; try again in a moment", port)
	}
	if time.Since(t0) >= 3*time.Second {
		writeLog(fmt.Sprintf("Tally %d: waited %ds for another FinCom request to finish first", port, int(time.Since(t0).Seconds())))
	}
	unlockOther := lockSharedMutex(port) // beside bridge 1.15.0 in the same Windows session: its own lock too
	return func() { unlockOther(); <-c }, nil
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
	busy := (at && time.Since(t) > time.Duration(keepNum("TallyBusySec", 8))*time.Second) || (cooling && time.Now().Before(c.until))
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
	if !tallyPortOpen(port) {
		return "closed"
	}
	if b, _ := tallyBusy(port); b {
		return "busy"
	}
	return "open"
}
func isBusyErr(err error) bool {
	return err != nil && re(`timed out|is busy|was closed|unexpected error occurred on a receive|forcibly closed`).MatchString(err.Error())
}

func invokeTally(tc *TC, port int, x string, timeoutSec int) (string, error) {
	coolMu.Lock()
	c, had := tallyCool[port]
	coolMu.Unlock()
	if had && time.Now().Before(c.until) {
		return "", fmt.Errorf("Tally (port %d) is busy and did not answer the last request; not asked again until %s", port, c.until.Format("15:04:05"))
	}
	wait := 120
	if timeoutSec > 0 {
		wait = minI(300, timeoutSec)
	}
	unlock, err := enterTallyLock(tc, port, wait)
	if err != nil {
		return "", err
	}
	t0 := time.Now()
	setInflight(port, true)
	r, err := tallyRaw(port, x, timeoutSec)
	setInflight(port, false)
	fail := ""
	if err == nil {
		coolMu.Lock()
		delete(tallyCool, port)
		coolMu.Unlock()
		busyMu.Lock()
		since, was := busySince[port]
		delete(busySince, port)
		busyMu.Unlock()
		if was {
			writeLog(fmt.Sprintf("Tally %d answers again (it was busy for %s)", port, time.Since(since).Round(time.Second)))
		}
		clearTallyStuck(port)
		// something was posted to Tally: the changed days are brought in and sent to the cloud in a minute or so
		if !tc.copier && re(`<TALLYREQUEST>\s*Import`).MatchString(x) {
			requestKeepLight()
		}
	} else {
		fail = err.Error()
		if re(`timed out|was closed|unexpected error occurred on a receive|forcibly closed`).MatchString(fail) {
			n := 1
			if had {
				n = c.n + 1
			}
			w := minI(120, 10*(1<<(n-1)))
			coolMu.Lock()
			tallyCool[port] = cool{n, time.Now().Add(time.Duration(w) * time.Second)}
			coolMu.Unlock()
			setTallyStuck(port)
			// said once a busy spell; the next tries are quiet
			busyMu.Lock()
			_, was := busySince[port]
			if !was {
				busySince[port] = t0
			}
			busyMu.Unlock()
			if !was {
				writeLog(fmt.Sprintf("Tally %d is busy (no answer in time); FinCom shows it as busy, and it is asked again quietly (first in %ds)", port, w))
			}
		}
	}
	if !tc.copier {
		setWant()
	}
	unlock()
	sec := time.Since(t0).Seconds()
	addTallyUse(tc, port, sec, x, fail)
	if tc.copier {
		keepSlowRead(sec)
	}
	return r, err
}

// --- "Tally not responding since HH:MM": kept in a file FinCom's status sees
func stuckFile() string { return filepath.Join(syncDir(), "tally-stuck.json") }
func setTallyStuck(port int) {
	o := readObjFile(stuckFile())
	since := nowS()
	if o != nil && toInt(o["port"]) == port {
		if l, ok := parseTime(str(o["last"])); ok && time.Since(l) < 15*time.Minute {
			since = str(o["since"])
		}
	}
	_ = saveFile(stuckFile(), jsonText(M{"port": port, "since": since, "last": nowS()}))
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
	if fail != "" && re(`is busy and did not answer the last request`).MatchString(fail) {
		quiet = true // a quiet retry while Tally is busy
	}
	if !quiet && (fail != "" || sec >= float64(keepNum("KeepSlowSec", 3))) {
		f := group(`<SVFROMDATE>(\d{8})</SVFROMDATE>`, x, 1)
		to := group(`<SVTODATE>(\d{8})</SVTODATE>`, x, 1)
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
