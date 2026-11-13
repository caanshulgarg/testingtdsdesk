package main

// bridge 2.5.10 (the owner, 08-Nov-2026: "Bridge should work every time except when Tally itself is unavailable"; the
// owner's server bridge went silent at 08:35:57 UTC for 5+ hours, every call answered until then, the cause unseen).
// The bridge heals itself; nothing here asks Tally anything, and how Tally is asked does not change:
//   - the heartbeat loop's own progress (beatLoopAt): the per-user supervisor (win_user.go) ends and restarts a worker
//     whose heartbeat has not moved for hangBeat, and the worker's own watchdog (beatWatch) ends itself first, with
//     the reason written down, when it is run by a supervisor or as a service (both start it again);
//   - a heartbeat that does not reach FinCom is tried again sooner, 5 s growing to 1 minute, never given up (beatPause);
//     after the computer slept or its clock jumped (the wall clock moved far more than the wait), or this computer's
//     network changed, at once, with the cloud's idle connections dropped (beatWait);
//   - why the last run ended, said once it runs again (lastStop: when it stopped and came back, a reason code, the
//     kind of the last log line, never its words or any client's data), in the beat for 6 hours and in a rotating local
//     crash log (crash-log.txt, 256 KB, one earlier file kept).
import (
	"encoding/json"
	"fmt"
	"io"
	mrand "math/rand"
	"net"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// --- the heartbeat loop's progress: a count of its turns and wait slices (the watchdogs judge by it), and the Unix
// seconds of the last one (for the log and /ping only)
var (
	beatLoopAt atomic.Int64
	beatLoopN  atomic.Int64
)

func noteBeat() {
	beatLoopAt.Store(time.Now().Unix())
	beatLoopN.Add(1)
}

// the beat turns every 30 s (a failed one sooner), its wait in 5 s slices: 3 minutes AWAKE without a move is a hang
var hangBeat = 3 * time.Minute

// review of 2.5.10 (1, HIGH): a stall is judged by the progress count across the watchdog's own looks, never by a
// clock's age: each look adds the time since the one before while the count stands still; a look that comes over three
// looks late (the computer slept or hibernated, or the clock jumped forward) or before the last (the clock went back)
// starts the count again (slept). A stall needs two looks or more without a move
type stallTracker struct {
	every  time.Duration
	lastN  int64
	lastAt time.Time
	stuck  time.Duration
	still  int
	begun  bool
}

func (t *stallTracker) observe(n int64, now time.Time) (stuck time.Duration, slept bool) {
	if !t.begun {
		t.begun, t.lastN, t.lastAt = true, n, now
		return 0, false
	}
	gap := now.Sub(t.lastAt)
	t.lastAt = now
	if n != t.lastN {
		t.lastN, t.stuck, t.still = n, 0, 0
		return 0, false
	}
	if gap < 0 || gap > 3*t.every {
		t.stuck, t.still = 0, 0
		return 0, true
	}
	t.stuck += gap
	t.still++
	if t.still < 2 {
		return 0, false
	}
	return t.stuck, false
}

func beatSec() int64 {
	if t := beatLoopAt.Load(); t > 0 {
		return time.Now().Unix() - t
	}
	return 0
}

// the pause after a heartbeat: the usual time when FinCom answered; after a failure 5, 10, 20, 40 s, then every minute,
// for as long as it takes (never longer than the usual time when that is shorter)
func beatPause(ok bool, fails int, every time.Duration) time.Duration {
	if ok {
		return every
	}
	d := 5 * time.Second
	for i := 0; i < fails && d < time.Minute; i++ {
		d *= 2
	}
	if d > time.Minute {
		d = time.Minute
	}
	if every > 0 && every < d {
		d = every
	}
	return d
}

// the clocks and the network, as the tests give them
var (
	wallNow   = func() time.Time { return time.Now().Round(0) } // the wall clock only (no monotonic reading)
	monoNow   = time.Now                                        // the monotonic clock (time.Since)
	netPrint  = localAddrs
	netLookAt time.Time
	netLast   string
)

// this computer's network, as a fingerprint of its adapters' IPv4 addresses (no name, nothing sent). Review of 2.5.10
// (7): IPv6 is left out (Windows' temporary addresses change by themselves every day), and so are adapters that are down,
// the loopback and virtual ones (Hyper-V, WSL, Docker, VirtualBox, VMware, tunnels, Bluetooth)
type ifaceAddrs struct {
	name  string
	up    bool
	loop  bool
	addrs []string
}

var reVirtualIf = regexp.MustCompile(`(?i)vethernet|hyper-v|wsl|docker|virtualbox|vmware|vbox|loopback|teredo|isatap|6to4|bluetooth|npcap|pseudo`)

func netPrintOf(l []ifaceAddrs) string {
	var out []string
	for _, f := range l {
		if !f.up || f.loop || reVirtualIf.MatchString(f.name) {
			continue
		}
		for _, a := range f.addrs {
			ip, _, err := net.ParseCIDR(a)
			if err != nil || ip.To4() == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, a)
		}
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func localAddrs() string {
	ifs, err := net.Interfaces()
	if err != nil {
		return ""
	}
	var l []ifaceAddrs
	for _, f := range ifs {
		e := ifaceAddrs{name: f.Name, up: f.Flags&net.FlagUp != 0, loop: f.Flags&net.FlagLoopback != 0}
		if as, err := f.Addrs(); err == nil {
			for _, a := range as {
				e.addrs = append(e.addrs, a.String())
			}
		}
		l = append(l, e)
	}
	return netPrintOf(l)
}

// review of 2.5.10 (7): a failed heartbeat's pause moved by up to a fifth either way, so many computers that lost the
// same network do not all come back in the same second
var jitterRand = func() float64 { return mrand.Float64() }

func beatJitter(d time.Duration) time.Duration {
	f := 0.8 + 0.4*jitterRand()
	return time.Duration(float64(d) * f)
}

// beatWait: the wait before the next heartbeat, in slices of at most 5 s (the loop's progress noted at each); it ends
// early with why: "now" (asked for: beatNow), "sleep" (the wall clock moved over 2 minutes more than the slice: the
// computer slept, or its clock was set), "network" (this computer's addresses changed), "stop"; "" when the time was up
func beatWait(d time.Duration, now <-chan struct{}, stop <-chan struct{}) string {
	end := monoNow().Add(d)
	for {
		noteBeat()
		left := end.Sub(monoNow())
		if left <= 0 {
			return ""
		}
		slice := left
		if slice > 5*time.Second {
			slice = 5 * time.Second
		}
		w0, m0 := wallNow(), monoNow()
		select {
		case <-stop:
			return "stop"
		case <-now:
			return "now"
		case <-time.After(slice):
		}
		if wallNow().Sub(w0)-monoNow().Sub(m0) > 2*time.Minute || wallNow().Sub(w0) > slice+2*time.Minute {
			noteBeat() // (review 1: the heartbeat's time refreshed before anything else looks at it)
			noteSleep(w0, wallNow())
			return "sleep"
		}
		if monoNow().Sub(netLookAt) >= 15*time.Second {
			netLookAt = monoNow()
			if p := netPrint(); p != netLast {
				was := netLast
				netLast = p
				if was != "" {
					writeLog("Heartbeat: this computer's network changed; FinCom is told at once")
					return "network"
				}
			}
		}
	}
}

// after a sleep or a network change: the cloud's idle connections are dropped (a connection of the old network would
// only time out)
func beatFresh() {
	if cloudHTTP != nil {
		cloudHTTP.CloseIdleConnections()
	}
}

// the heartbeat loop's own watchdog: a heartbeat that has not moved for hangBeat ends this worker (with the reason
// written down) when something starts it again (the supervisor, Windows' service recovery); by hand it only says so
var beatWatchExit = func(code int) { exitDrained(code) } // 2.5.15: the files still being flushed first (safefile.go)

const exitStall = 13 // the worker ended itself: its heartbeat stalled (the supervisor starts it again at once)

// review of 2.5.10 (2, MEDIUM): the exit waits while a posting is being sent or a Tally is still on a request the bridge
// gave up on (at most TallyAbandonMaxSec): ending then would cut a posting short, or let the next run send into a Tally
// still busy (the hold is also kept on disk across a restart: inflight.go earlierSave)
var watchBusy = func() string {
	if postingGoing() || importsInFlight.Load() > 0 {
		return "a posting is being sent to Tally"
	}
	if earlierBusyAny() {
		return "Tally is still on an earlier request"
	}
	return ""
}

// what the worker's /ping says keeps it from ending (the supervisor waits for it as the worker's own watchdog does)
func watchBusyOf(ping M) string { return cutRunes(str(ping["busy"]), 100) }

func beatWatch(stop <-chan struct{}, every time.Duration) {
	tr := stallTracker{every: every}
	said, waitSaid, cat := false, false, ""
	var waitFrom time.Time
	for {
		select {
		case <-stop:
			return
		case <-time.After(every):
		}
		stuck, slept := tr.observe(beatLoopN.Load(), wallNow())
		if slept {
			writeLogOnce("watch|slept", "Watchdog: a late look (the computer slept or its clock changed); the heartbeat is judged afresh", 10*time.Minute)
		}
		if stuck < hangBeat || stopping() {
			said, waitSaid, waitFrom, cat = false, false, time.Time{}, ""
			continue
		}
		if cat == "" {
			cat = or(lastLogCat(), "other") // what it was doing (before the watchdog's own lines)
		}
		m := int(stuck.Minutes())
		if runMode != "user" && runMode != "service" {
			if !said {
				writeLog(fmt.Sprintf("Watchdog: the heartbeat has not moved for %d minutes (started by hand: nothing restarts it; close and start FinCom Bridge again)", m))
				said = true
			}
			continue
		}
		if b := watchBusy(); b != "" {
			if waitFrom.IsZero() {
				waitFrom = monoNow()
			}
			if monoNow().Sub(waitFrom) < abandonMax() {
				if !waitSaid {
					writeLog("Watchdog: the heartbeat has not moved for " + fmt.Sprint(m) + " minutes; FinCom Bridge ends itself once " + b + " no more (at most " + abandonMax().String() + ")")
					waitSaid = true
				}
				continue
			}
		}
		writeLog(fmt.Sprintf("Watchdog: the heartbeat has not moved for %d minutes; FinCom Bridge ends itself and is started again", m))
		earlierSave() // (the holds of a Tally still busy, for the next run)
		saveLastStop(lastStop{At: time.Now().Add(-stuck), Why: "stall", Log: cat})
		beatWatchExit(exitStall)
		return
	}
}

// --- why the last run ended
type lastStop struct {
	At   time.Time `json:"at"`             // when it stopped (or the computer went to sleep)
	Back time.Time `json:"back,omitempty"` // when it ran again
	Why  string    `json:"why"`            // exit | panic | stall | hang | sleep | unclean | notRunning
	Code int       `json:"code,omitempty"` // the exit code, when it ended with one
	Log  string    `json:"log,omitempty"`  // the kind of the last log line (logCategory)
}

var lastStopWhys = map[string]bool{"exit": true, "panic": true, "stall": true, "hang": true, "sleep": true, "unclean": true, "notRunning": true}

var stopMu sync.Mutex

func lastStopFile() string { return sp("last-stop.json") }
func runningFile() string  { return sp("running.txt") }
func crashLogFile() string { return sp("crash-log.txt") }

func readLastStop() *lastStop {
	var s lastStop
	if json.Unmarshal([]byte(readText(lastStopFile())), &s) != nil || !lastStopWhys[s.Why] || s.At.IsZero() {
		return nil
	}
	return &s
}

// written once the reason is known (Back left zero: the next start fills it in), and a line in the crash log
func saveLastStop(s lastStop) {
	if !lastStopWhys[s.Why] {
		return
	}
	stopMu.Lock()
	defer stopMu.Unlock()
	b, _ := json.Marshal(s)
	_ = saveFile(lastStopFile(), string(b))
	crashLogLine(string(b))
}

func crashLogLine(line string) {
	f := crashLogFile()
	if fi, err := os.Stat(f); err == nil && fi.Size() > 256*1024 {
		_ = os.Remove(f + ".1")
		_ = os.Rename(f, f+".1")
	}
	_ = appendText(f, time.Now().UTC().Format(time.RFC3339)+"  "+line+"\r\n")
}

// at the start of a run: the run before ended without a word (its mark is still there, and no reason newer than it was
// written: the computer turned off or restarted, Windows ended it), or with the reason it wrote; now it runs again.
// The mark of this run is then written (removed at a clean end: runEnded)
func runStarted() {
	now := time.Now()
	if t, ok := mtime(runningFile()); ok {
		s := readLastStop()
		st, _ := mtime(lastStopFile())
		if s == nil || st.Before(t) || !s.Back.IsZero() {
			why := "unclean"
			if k, ok := mtime(keepAliveHintFile()); ok && !k.Before(t) {
				why = "notRunning" // the keep-alive task found it not running and started it
			}
			saveLastStop(lastStop{At: lastAliveAt(t), Why: why, Log: lastLogTailCat(logFile())})
		}
	}
	if s := readLastStop(); s != nil && s.Back.IsZero() {
		s.Back = now
		stopMu.Lock()
		b, _ := json.Marshal(s)
		_ = saveFile(lastStopFile(), string(b))
		stopMu.Unlock()
		writeLog(fmt.Sprintf("FinCom Bridge runs again after %s (stopped %s)", lastStopWords(s.Why, s.Code), s.At.Local().Format("02-Jan 15:04:05")))
	}
	_ = os.Remove(keepAliveHintFile())
	_ = saveFile(runningFile(), now.UTC().Format(time.RFC3339))
}

func keepAliveHintFile() string { return sp("keepalive-start.txt") }

// the run's mark is kept fresh (every heartbeat): its time is when the run was last seen alive
func runAlive() { _ = saveFile(runningFile(), time.Now().UTC().Format(time.RFC3339)) }
func runEnded() { _ = os.Remove(runningFile()) }

func lastAliveAt(t time.Time) time.Time {
	if x, err := time.Parse(time.RFC3339, strings.TrimSpace(readText(runningFile()))); err == nil && x.After(t.Add(-time.Hour)) {
		return x
	}
	return t
}

// a sleep noticed by the heartbeat's wait: written down (the run goes on; said in the beat as the others)
func noteSleep(from, to time.Time) {
	writeLog(fmt.Sprintf("Heartbeat: the computer slept or its clock changed (%s to %s); FinCom is told at once", from.Format("15:04:05"), to.Format("15:04:05")))
	saveLastStop(lastStop{At: from, Back: to, Why: "sleep"})
	beatFresh()
}

// the supervisor (win_user.go): a worker that ended with a code (not asked to: 0 and 3 are a stop or a restart asked
// for, exitStall wrote its own reason) or was ended as hung
func superviseNote(code int, hung bool) {
	switch {
	case hung:
		saveLastStop(lastStop{At: time.Now(), Why: "hang", Code: code, Log: lastLogTailCat(logFile())})
	case code == 0 || code == 3 || code == exitStall:
	case code == 2:
		saveLastStop(lastStop{At: time.Now(), Why: "panic", Code: code, Log: lastLogTailCat(logFile())}) // Go's exit code for a panic nothing recovered
	default:
		saveLastStop(lastStop{At: time.Now(), Why: "exit", Code: code, Log: lastLogTailCat(logFile())})
	}
}

func lastStopWords(why string, code int) string {
	switch why {
	case "exit":
		return fmt.Sprintf("it stopped unexpectedly (code %d)", code)
	case "panic":
		return "an error inside FinCom Bridge"
	case "stall":
		return "its heartbeat stopped moving"
	case "hang":
		return "it stopped answering on this computer"
	case "sleep":
		return "the computer slept or its clock changed"
	case "notRunning":
		return "it was not running (started again by the keep-alive task)"
	}
	return "it was ended without stopping (the computer was turned off or restarted, or Windows ended it)"
}

// for the beat: the last stop, for 6 hours after it ran again (nil otherwise)
func lastStopBeat() any {
	s := readLastStop()
	if s == nil || s.Back.IsZero() || time.Since(s.Back) > 6*time.Hour || time.Since(s.Back) < -time.Hour {
		return nil
	}
	m := M{"at": s.At.UTC().Format(time.RFC3339), "back": s.Back.UTC().Format(time.RFC3339), "why": s.Why}
	if s.Code != 0 {
		m["code"] = s.Code
	}
	if s.Log != "" {
		m["log"] = s.Log
	}
	return m
}

// --- the kind of a log line, never its words (a company's or a person's name stays on the computer)
var logCats = []struct {
	cat string
	rx  *regexp.Regexp
}{
	{"heartbeat", regexp.MustCompile(`^(Heartbeat|FinCom: |Test mode: FinCom)`)},
	{"posting", regexp.MustCompile(`^(Posting job|  (voucher|entry) |Posting)`)},
	{"olderEntries", regexp.MustCompile(`^Older entries`)},
	{"recorder", regexp.MustCompile(`^(Recorder|Live|The recorder)`)},
	{"update", regexp.MustCompile(`^(Update|The program was replaced|Updating|An update)`)},
	{"ledgers", regexp.MustCompile(`^(Ledger|Ledgers|The ledger)`)},
	{"company", regexp.MustCompile(`^(Company|Company list|Companies)`)},
	{"watchdog", regexp.MustCompile(`^(Watchdog|The bridge stopped|The bridge did not stop)`)},
	{"start", regexp.MustCompile(`^(FinCom Bridge \d|FinCom Bridge runs again|Stopping|Started)`)},
	{"tally", regexp.MustCompile(`(?i)tally`)},
}

func logCategory(line string) string {
	line = strings.TrimSpace(line)
	if len(line) > 21 && line[4] == '-' && line[10] == ' ' {
		line = strings.TrimSpace(line[19:]) // the line's time
	}
	if line == "" {
		return ""
	}
	for _, c := range logCats {
		if c.rx.MatchString(line) {
			return c.cat
		}
	}
	return "other"
}

var lastLogText atomic.Value // the last line this process wrote (for its own stall note)

func lastLogCat() string {
	if s, ok := lastLogText.Load().(string); ok {
		return logCategory(s)
	}
	return lastLogTailCat(logFile())
}

// the kind of the last line of the log file (the supervisor's look at what the worker last wrote)
func lastLogTailCat(f string) string {
	h, err := os.Open(f)
	if err != nil {
		return ""
	}
	defer h.Close()
	if fi, err := h.Stat(); err == nil && fi.Size() > 4096 {
		_, _ = h.Seek(fi.Size()-4096, io.SeekStart)
	}
	b, _ := io.ReadAll(io.LimitReader(h, 8192))
	ls := strings.Split(strings.ReplaceAll(string(b), "\r", ""), "\n")
	for i := len(ls) - 1; i >= 0; i-- {
		if c := logCategory(ls[i]); c != "" && c != "watchdog" { // (the supervisor's own line about it)
			return c
		}
	}
	return ""
}
