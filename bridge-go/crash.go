package main

// Crash reports to Sentry (docs/sentry.md; the owner's conditions of 08-Oct-2026). OFF unless the settings say
// "CrashReports": true AND the bridge is connected to FinCom's STAGING cloud (CloudUrl on the staging project); never on a
// bridge connected to any other cloud. Only a panic the bridge recovered (its loops, the service, the worker): the error's
// type and scrubbed words, the code location (function, file, line), where in the bridge, the bridge's version and
// Windows' version. Never a log line, a breadcrumb, Tally's data or XML, a company's name, the computer's or a user's name,
// or a folder (a path's folders may carry a Windows user's name). No request to Tally is changed or added; the report goes
// to Sentry only. The rules are the shared scrubber's (server/_shared/sentry-scrub.js), word for word (crash_test.go).

import (
	"fmt"
	"net/url"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/getsentry/sentry-go"
)

const bridgeDSN = "https://996dcfb450a80d90ef19d3e7c6fc8a97@o4512221111320576.ingest.us.sentry.io/4512221235642368"
const crashStagingHost = "qbocskaiewaxqcvaunzc.supabase.co"

var (
	crashMu     sync.Mutex
	crashClient *sentry.Client
	crashSeen   = map[string]time.Time{}
	crashHour   time.Time
	crashCount  int
)

// a panic value that is not an error (a string, a number): reported as type "panic"
type crashPanic struct{ msg string }

func (p *crashPanic) Error() string { return p.msg }

// whether this bridge may report crashes: the settings say so, and it is connected to the staging cloud
func crashWanted() bool {
	if v, ok := cfg("CrashReports").(bool); !ok || !v {
		return false
	}
	u, err := url.Parse(cfgS("CloudUrl"))
	return err == nil && u.Scheme == "https" && u.Host == crashStagingHost
}

// crashStart starts the reports when wanted (dsn: bridgeDSN; a test's stand-in Sentry). Called after the settings load
func crashStart(dsn string) bool {
	crashMu.Lock()
	defer crashMu.Unlock()
	if crashClient != nil {
		return true
	}
	if !crashWanted() {
		return false
	}
	c, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:                    dsn,
		Environment:            "staging",
		Release:                "fincom-bridge-" + BridgeVersion,
		SendDefaultPII:         false,
		AttachStacktrace:       false,
		MaxBreadcrumbs:         -1,
		DisableClientReports:   true,
		DisableTelemetryBuffer: true,
		EnableLogs:             false,
		DisableMetrics:         true,
		// none of sentry-go's own additions (the computer's details, the program's modules, source lines, SENTRY_* tags)
		Integrations:     func([]sentry.Integration) []sentry.Integration { return nil },
		BeforeBreadcrumb: func(*sentry.Breadcrumb, *sentry.BreadcrumbHint) *sentry.Breadcrumb { return nil },
		BeforeSend:       func(e *sentry.Event, _ *sentry.EventHint) *sentry.Event { return crashScrub(e) },
	})
	if err != nil {
		return false
	}
	crashClient = c
	crashSeen = map[string]time.Time{}
	return true
}

// crashStop: the reports sent so far waited for (at most 3 seconds), then off
func crashStop() {
	crashMu.Lock()
	c := crashClient
	crashClient = nil
	crashMu.Unlock()
	if c != nil {
		c.Flush(3 * time.Second)
		c.Close()
	}
}

func crashFlush() {
	crashMu.Lock()
	c := crashClient
	crashMu.Unlock()
	if c != nil {
		c.Flush(3 * time.Second)
	}
}

// crashReport: a recovered panic (r from recover()) reported, if reports are on. where: a fixed name of the place in the
// bridge (heartbeat, posting_job, ...). The same panic at most once an hour, at most 30 reports an hour. Never panics
func crashReport(where string, r any) {
	if r == nil {
		return
	}
	defer func() { _ = recover() }()
	crashMu.Lock()
	c := crashClient
	if c == nil {
		crashMu.Unlock()
		return
	}
	var err error
	switch v := r.(type) {
	case error:
		err = v
	default:
		err = &crashPanic{msg: fmt.Sprint(v)}
	}
	now := time.Now()
	if now.Sub(crashHour) > time.Hour {
		crashHour, crashCount = now, 0
	}
	sig := where + "|" + crashText(err.Error())
	if t, ok := crashSeen[sig]; (ok && now.Sub(t) < time.Hour) || crashCount >= 30 {
		crashMu.Unlock()
		return
	}
	crashSeen[sig] = now
	crashCount++
	crashMu.Unlock()
	ev := c.EventFromException(err, sentry.LevelFatal)
	// the stack where the panic was recovered (a deferred function runs on the panicking goroutine's stack)
	if len(ev.Exception) > 0 && ev.Exception[len(ev.Exception)-1].Stacktrace == nil {
		ev.Exception[len(ev.Exception)-1].Stacktrace = sentry.NewStacktrace()
	}
	ev.Tags = map[string]string{"where": where}
	c.CaptureEvent(ev, nil, nil)
}

// ---- the scrubber: a new event from the allowed fields only

var crashWordList = `a an the of to in on at by for from with without into onto as is are was were be been being not no nor and or
but if then else than this that these those it its it's can cannot can't could couldn't would should must may
might will won't do does did done don't doesn't didn't has have had having get got set unset new old same
other another any all each every some none only also just still yet again already more less most least too
very there here when where which what who why how read reading write writing call called calling load loaded
loading parse parsing open opened close closed send sent sending receive received fetch fetched fetching
request requested response responded reply answer answered find found undefined null nan true false infinity
object objects array arrays string strings number numbers function functions property properties method
methods value values key keys type types index item items element elements node nodes argument arguments
parameter parameters variable variables constructor prototype instance class module modules token tokens
character characters input output end start position line lines column columns field fields length size count
limit maximum minimum max min range offset depth stack frame frames level levels error errors exception
exceptions failed failure fail fails failing invalid valid unexpected expected unknown missing unable allowed
permitted denied refused rejected blocked aborted abort aborts timeout timed out exceeded overflow network
connection connect connected disconnected reset refused unreachable offline online server client browser
permission permissions access unauthorized forbidden authentication authenticated session expired defined
declared initialized initialised assign assigned assignment constant reference iterable callable syntax json
html xml http https url uri script scripts resource resources chunk chunks dynamically imported import export
exports default promise promises async await rejection unhandled handled uncaught caught throw thrown quota
storage database table tables column row rows relation constraint violates violated duplicate unique primary
schema cache query queries rpc exist exists does doesn't support supported unsupported operation operations
memory internal external panic runtime nil pointer dereference slice bounds out channel closed goroutine
goroutines deadlock map maps concurrent iteration conversion interface converted division zero integer divide
address addresses capacity asleep writes reads signal segmentation violation fault page pages screen screens
part drawn draw render rendering shown show component components hook hooks bill bills ledger ledgers bank
statement statements entry entries voucher vouchers posting postings post posted company companies party
parties upload uploads uploaded file files document documents report reports book books sync line queue
queued job jobs bridge cloud computer device beat heartbeat recorder lease guard state step day days month
months year years period list lists name names id ids number amount amounts date dates tax please try retry
later now again ok yes because while during after before since until via per`

var (
	crashWords   = map[string]bool{}
	crashNames   = map[string]bool{}
	reCrashClass = regexp.MustCompile(`^[A-Z][A-Za-z]{0,40}(Error|Exception)$`)
	reCrashCode  = regexp.MustCompile(`^[a-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*(\(\))?$`)
	reCrashCap   = regexp.MustCompile(`^[A-Z][a-z']+$`)
	reCrash3Caps = regexp.MustCompile(`[A-Z]{3}`)
	reCrashMark  = regexp.MustCompile(`<[^>]{0,400}>`)
	reCrashLead  = regexp.MustCompile(`^[(\[{'"“‘` + "`" + `<]+`)
	reCrashTrail = regexp.MustCompile(`[)\]}'"”’` + "`" + `>:;,.!?]+$`)
	reCrashPunct = regexp.MustCompile(`^[(\[{)\]}:;,.!?'"“”‘’` + "`" + `-]+$`)
	reCrashRun   = regexp.MustCompile(`…[:;,.]?(?:\s+…[:;,.]?)+`)
	reCrashGoTyp = regexp.MustCompile(`^\*?[a-z][a-z0-9]*\.[A-Za-z][A-Za-z0-9]*$`)
	reCrashFunc  = regexp.MustCompile(`^[A-Za-z0-9_.()*\[\]]{1,120}$`)
	reCrashMod   = regexp.MustCompile(`^[a-z][a-z0-9._-]*(/[A-Za-z0-9._-]+){0,4}$`)
	reCrashFile  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,80}\.go$`)
	reCrashDir   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,80}$`)
	reCrashOS    = regexp.MustCompile(`^[A-Za-z0-9 ._()+/-]{1,80}$`)
	reCrashWhere = regexp.MustCompile(`^[a-z][a-z0-9_ .:-]{0,60}$`)
)

func init() {
	for _, w := range strings.Fields(crashWordList) {
		crashWords[w] = true
	}
	for _, n := range strings.Fields("JSON HTML XML HTTP HTTPS URL URI API DOM CSS SQL RPC JWT UUID ID OK NaN CORS TLS SSL TCP DNS GST TDS PDF CSV IST UTF EOF IO OS PGRST " +
		"TypeScript JavaScript FinCom Tally TallyPrime React Supabase Deno Chrome Firefox Safari Edge Windows Linux Go Sentry Postgres PostgreSQL WebSocket " +
		"Promise Object Array String Number Function Symbol Date Map Set Response Request Headers Blob File Storage Worker Element Node Document Window") {
		crashNames[n] = true
	}
}

func crashCodeName(w string) bool {
	if len(w) > 60 || !reCrashCode.MatchString(w) || reCrash3Caps.MatchString(w) {
		return false
	}
	if !strings.ContainsAny(w, "ABCDEFGHIJKLMNOPQRSTUVWXYZ_.$") && !strings.HasSuffix(w, "()") {
		return false
	}
	return strings.Count(w, "0")+strings.Count(w, "1")+strings.Count(w, "2")+strings.Count(w, "3")+strings.Count(w, "4")+
		strings.Count(w, "5")+strings.Count(w, "6")+strings.Count(w, "7")+strings.Count(w, "8")+strings.Count(w, "9") <= 2
}

func crashSafeWord(w string) bool {
	if len(w) <= 2 && len(w) > 0 && strings.Trim(w, "0123456789") == "" {
		return true
	}
	if crashWords[w] || crashNames[w] || reCrashClass.MatchString(w) {
		return true
	}
	if reCrashCap.MatchString(w) && crashWords[strings.ToLower(w)] {
		return true
	}
	return crashCodeName(w)
}

// crashText: the words of an error, each kept only when known to be safe (as scrubText in sentry-scrub.js); at most 300
func crashText(s string) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "?")
	}
	if r := []rune(s); len(r) > 4000 {
		s = string(r[:4000])
	}
	s = reCrashMark.ReplaceAllString(s, " … ")
	var out []string
	for _, tok := range strings.Fields(s) {
		lead := reCrashLead.FindString(tok)
		rest := tok[len(lead):]
		trail := reCrashTrail.FindString(rest)
		core := rest[:len(rest)-len(trail)]
		switch {
		case core == "":
			if reCrashPunct.MatchString(tok) {
				out = append(out, tok)
			} else {
				out = append(out, "…")
			}
		case crashSafeWord(core):
			out = append(out, lead+core+trail)
		default:
			if trail != "" && strings.Trim(trail, ":;,.") == "" {
				out = append(out, "…"+trail)
			} else {
				out = append(out, "…")
			}
		}
	}
	j := strings.Join(strings.Fields(reCrashRun.ReplaceAllString(strings.Join(out, " "), "…")), " ")
	if r := []rune(j); len(r) > 300 {
		j = string(r[:299]) + "…"
	}
	return j
}

func crashType(t string) string {
	if t == "*main.crashPanic" {
		return "panic"
	}
	if reCrashGoTyp.MatchString(t) && !strings.HasPrefix(strings.TrimPrefix(t, "*"), "main.") {
		return t
	}
	return "error"
}

// a frame: function, package, the file's name (never its folders), line
func crashFrame(f sentry.Frame) sentry.Frame {
	o := sentry.Frame{Function: "?", Filename: "?", Lineno: f.Lineno, InApp: f.InApp}
	if reCrashFunc.MatchString(f.Function) {
		o.Function = f.Function
	}
	if reCrashMod.MatchString(f.Module) && len(f.Module) <= 80 {
		o.Module = f.Module
	}
	name := f.Filename
	if name == "" {
		name = f.AbsPath
	}
	name = strings.ReplaceAll(name, `\`, "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	if reCrashFile.MatchString(name) {
		o.Filename = name
	}
	return o
}

func crashScrub(e *sentry.Event) *sentry.Event {
	if e == nil || (e.Type != "" && e.Type != "event") {
		return nil
	}
	o := sentry.NewEvent()
	o.EventID, o.Timestamp, o.Platform, o.Environment = e.EventID, e.Timestamp, "go", "staging"
	o.Level = sentry.LevelFatal
	if e.Level == sentry.LevelError || e.Level == sentry.LevelWarning {
		o.Level = e.Level
	}
	o.Release = "fincom-bridge-" + BridgeVersion
	if n := len(e.Exception); n > 0 {
		ex := e.Exception
		if n > 5 {
			ex = ex[n-5:]
		}
		for _, x := range ex {
			y := sentry.Exception{Type: crashType(x.Type), Value: crashText(x.Value)}
			if x.Mechanism != nil {
				y.Mechanism = &sentry.Mechanism{Type: "panic", Handled: x.Mechanism.Handled, ExceptionID: x.Mechanism.ExceptionID}
			}
			if x.Stacktrace != nil {
				fr := x.Stacktrace.Frames
				if len(fr) > 50 {
					fr = fr[len(fr)-50:]
				}
				st := &sentry.Stacktrace{}
				for _, f := range fr {
					if f.Function == "crashReport" && f.Module == "fincom/bridge" {
						continue // where the report was made, not where the panic was
					}
					st.Frames = append(st.Frames, crashFrame(f))
				}
				y.Stacktrace = st
			}
			o.Exception = append(o.Exception, y)
		}
	}
	if e.Message != "" {
		o.Message = crashText(e.Message)
	}
	if w := e.Tags["where"]; reCrashWhere.MatchString(w) && crashText(w) == w {
		o.Tags = map[string]string{"where": w}
	}
	osName, osVer := "Windows", windowsVersion()
	if runtime.GOOS != "windows" {
		osName = runtime.GOOS
	}
	osCtx := sentry.Context{"name": osName}
	if reCrashOS.MatchString(osVer) {
		osCtx["version"] = osVer
	}
	o.Contexts = map[string]sentry.Context{"os": osCtx}
	o.Sdk = sentry.SdkInfo{Name: "sentry.go", Version: e.Sdk.Version}
	return o
}
