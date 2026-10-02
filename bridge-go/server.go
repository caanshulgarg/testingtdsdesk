// The small web server FinCom talks to, on this computer only (127.0.0.1:9100): the same addresses, answers, key and
// connect code as bridge 1.15.0, so FinCom works with either bridge.
package main

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	pairMu    sync.Mutex
	pairCode  string
	pairUntil time.Time
	pairTries int
)

func newPairCode() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%06d", binary.LittleEndian.Uint32(b)%1000000)
}
func openPairWindow(min int) {
	pairMu.Lock()
	pairCode, pairUntil, pairTries = newPairCode(), time.Now().Add(time.Duration(min)*time.Minute), 0
	pairMu.Unlock()
}

// the pages allowed to talk to the bridge: FinCom's own addresses (settings: AllowedOrigins); 'http://localhost' any port
func allowedOrigin(o string) bool {
	if o == "" {
		return true
	}
	for _, a := range []string{"https://app.fincom.live", "https://staging.fincom.live", "https://fincom.live", "https://caanshulgarg.github.io"} {
		if o == a {
			return true
		}
	}
	for _, a := range strs(cfg("AllowedOrigins")) {
		if o == a {
			return true
		}
		if a == "http://localhost" && re(`^http://(localhost|127\.0\.0\.1)(:\d+)?$`).MatchString(o) {
			return true
		}
	}
	return false
}

func writeResp(w http.ResponseWriter, status int, body, origin, ctype string, maxAge bool) {
	h := w.Header()
	if ctype == "" {
		ctype = "application/json; charset=utf-8"
	}
	h.Set("Content-Type", ctype)
	h.Set("Content-Length", fmt.Sprint(len(body)))
	if origin != "" {
		h.Set("Access-Control-Allow-Origin", origin)
	}
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Key")
	h.Set("Access-Control-Allow-Private-Network", "true")
	if maxAge {
		h.Set("Access-Control-Max-Age", "600")
	}
	h.Set("Cache-Control", "no-store")
	h.Set("Vary", "Origin")
	h.Set("Connection", "close")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}
func sendJSON(w http.ResponseWriter, status int, v any, origin string) {
	writeResp(w, status, jsonText(v), origin, "", true)
}

type httpErr struct {
	status int
	body   any
}

func (e *httpErr) Error() string { return fmt.Sprint(e.body) }

func qint(q url.Values, k string) int { return toInt(q.Get(k)) }

func handle(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 50*1024*1024)
	sentOrigin := r.Header.Get("Origin")
	originOK := allowedOrigin(sentOrigin)
	origin := ""
	if sentOrigin != "" && originOK {
		origin = sentOrigin
	}
	path, qs := r.URL.Path, r.URL.Query()
	if r.Method == "OPTIONS" {
		sendJSONRaw(w, 204, "", origin)
		return
	}
	if path == "/ping" {
		// pid and loopSec: the per-user supervisor checks that its own worker answers and that its main loop still turns
		sendJSON(w, 200, M{"ok": true, "bridge": "FinCom Tally Bridge", "version": BridgeVersion, "impl": "go", "testMode": testMode(), "runMode": runMode, "pid": os.Getpid(), "loopSec": loopSec()}, origin)
		return
	}
	if sentOrigin != "" && !originOK {
		writeLog("Refused a request from the web page " + sentOrigin + " (not FinCom).")
		sendJSON(w, 403, M{"ok": false, "error": "This bridge answers FinCom only."}, origin)
		return
	}
	if path == "/pair" {
		code := qs.Get("code")
		pairMu.Lock()
		open := time.Now().Before(pairUntil)
		if open && code != pairCode {
			pairTries++
			n := pairTries
			if n >= 5 {
				pairUntil = time.Now().Add(-time.Minute)
			}
			pairMu.Unlock()
			writeLog(fmt.Sprintf("A wrong connect code was typed (%d of 5).", n))
			if n >= 5 {
				writeLog("Five wrong codes: connecting is closed until the bridge is started again.")
			}
			msg := "Type the 6-digit code shown in the bridge window."
			if code != "" {
				msg = "That is not the code shown in the bridge window."
			}
			sendJSON(w, 403, M{"ok": false, "error": msg, "needCode": true}, origin)
			return
		}
		if open {
			pairUntil = time.Now().Add(-time.Minute) // one connection per code
			pairMu.Unlock()
			writeLog("FinCom connected with the code (" + sentOrigin + ").")
			sendJSON(w, 200, M{"ok": true, "key": cfgS("Key"), "computer": computerName(), "user": ownerName(), "version": BridgeVersion}, origin)
			return
		}
		pairMu.Unlock()
		sendJSON(w, 403, M{"ok": false, "error": fmt.Sprintf("The connect window has closed. In the FinCom Bridge tray icon choose Connect FinCom, then type the code shown within %d minutes.", toInt(cfg("PairWindowMin")))}, origin)
		return
	}
	if r.Header.Get("X-Bridge-Key") != cfgS("Key") {
		sendJSON(w, 401, M{"ok": false, "error": "Wrong bridge key. Copy the key shown in the bridge window into FinCom Settings."}, origin)
		return
	}
	bodyB, err := io.ReadAll(r.Body)
	if err != nil {
		sendJSON(w, 400, M{"ok": false, "error": "Request too large."}, origin)
		return
	}
	body := string(bodyB)
	// FinCom in use on this computer (for the nightly catch-up, when the cloud has no signal): a person's request, not
	// the status checks the page and the tray make every minute
	if !strings.HasPrefix(path, "/tray/") && path != "/status" && path != "/logtail" && path != "/synced" && path != "/diagnose" && path != "/paircode" {
		noteUse()
	}
	res, err := route(w, r, path, qs, body, origin)
	if err == errSent {
		return
	}
	if err != nil {
		var he *httpErr
		if errors.As(err, &he) {
			sendJSON(w, he.status, he.body, origin)
			return
		}
		msg := err.Error()
		if re(`Unable to connect|actively refused|No connection could be made|Connection refused`).MatchString(msg) {
			msg = `Tally is not answering on this computer. In TallyPrime: F1 Help > Settings > Connectivity > set "TallyPrime acts as" to Both (or Server) and port 9000.`
		}
		writeLog("ERROR " + path + ": " + msg)
		sendJSON(w, 502, M{"ok": false, "error": msg}, origin)
		return
	}
	sendJSON(w, 200, res, origin)
}

func sendJSONRaw(w http.ResponseWriter, status int, body, origin string) {
	writeResp(w, status, body, origin, "", true)
}

var errSent = errors.New("sent")

func bodyObj(body string) (M, error) {
	o := parseObj(body)
	if o == nil {
		return nil, errors.New("The request is not JSON.")
	}
	return o, nil
}
func needPost(r *http.Request, msg string) error {
	if r.Method != "POST" {
		return errors.New(msg)
	}
	return nil
}

func route(w http.ResponseWriter, r *http.Request, path string, qs url.Values, body, origin string) (any, error) {
	co := qs.Get("company")
	switch path {
	case "/status":
		jobsNow := []any{}
		for _, j := range activeJobs() {
			if str(obj(j)["status"]) != "interrupted" {
				jobsNow = append(jobsNow, j)
			}
		}
		var sessions []M
		if qs.Get("fresh") != "" {
			sessions = openCompanies(false)
		} else {
			sessions = openCompaniesCached() // Tally is not asked on a status check, unless a person's action asks
		}
		why := readOnlyWhy()
		coMu.Lock()
		pm := planMode
		coMu.Unlock()
		return M{"ok": true, "version": BridgeVersion, "computer": computerName(), "user": ownerName(), "mySession": mySession(), "mode": pm, "onlyMySession": cfgB("OnlyMySession"), "time": nowS(),
			"sessions": sessions, "allowImport": cfgB("AllowImport") && why == "", "readOnly": why, "impl": "go", "testMode": testMode(), "paused": paused(),
			"tallyStuck": getTallyStuck(), "wake": wakeStatus(), "jobs": jobsNow, "posting": postingNow(), "tally": tallyStatus(sessions), "beat": beatStatus()}, nil
	case "/companies":
		list := []any{}
		for _, s := range openCompanies(false) {
			if s["skipped"] == true {
				continue
			}
			for _, c := range sessCompanies(s) {
				list = append(list, M{"name": c["name"], "port": s["port"], "mine": s["mine"], "from": c["from"], "to": c["to"]})
			}
		}
		return M{"ok": true, "companies": list}, nil
	case "/diagnose":
		return diagnosis(), nil
	case "/readtest":
		return readTest(co, qint(qs, "port"))
	case "/ledgers":
		return getLedgers(co, qint(qs, "port"))
	case "/ledgervouchers":
		return getLedgerVouchers(co, qs.Get("ledger"), qs.Get("from"), qs.Get("to"), qint(qs, "port"))
	case "/vouchers":
		return getVouchers(co, qs.Get("from"), qs.Get("to"), qs.Get("ledger"), qs.Get("types"), qint(qs, "port"))
	case "/unpost":
		if why := readOnlyWhy(); why != "" {
			return nil, errors.New(why)
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		company := str(o["company"])
		port, err := findCompanyPort(company, qint(qs, "port"))
		if err != nil {
			return nil, err
		}
		vtype, vdate, vnum := str(o["vchType"]), str(o["vchDate"]), str(o["vchNumber"])
		rv, err := removeTallyVoucher(port, company, str(o["guid"]), str(o["masterId"]), vtype, vdate, vnum)
		if err != nil {
			return M{"ok": false, "error": "Tally did not answer: " + err.Error()}, nil
		}
		st := "FAILED " + str(rv["message"])
		if rv["ok"] == true {
			st = "removed (" + str(rv["how"]) + ")"
		}
		writeLog("Unpost " + vtype + " " + vnum + " of " + vdate + " from '" + company + "': " + st)
		e := ""
		if rv["ok"] != true {
			e = str(rv["message"])
		}
		return M{"ok": rv["ok"] == true, "company": company, "port": port, "message": rv["message"], "error": e, "how": rv["how"]}, nil
	case "/import":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return invokeImport(o)
	case "/seed":
		if err := needPost(r, "Send the day book with POST."); err != nil {
			return nil, err
		}
		return importKeepSeed(co, qs.Get("from"), qs.Get("to"), body)
	case "/keepmode":
		if err := needPost(r, "POST only."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return setKeepMode(str(o["company"]), str(o["mode"]))
	case "/seedbal":
		if err := needPost(r, "Send the balances with POST."); err != nil {
			return nil, err
		}
		return importKeepOpening(co, body)
	case "/logtail":
		n := qint(qs, "n")
		if n <= 0 {
			n = 200
		}
		n = minI(2000, n)
		lines := []any{}
		all := strings.Split(strings.TrimRight(strings.ReplaceAll(readText(logFile()), "\r\n", "\n"), "\n"), "\n")
		for _, l := range all[maxI(0, len(all)-n):] {
			if l != "" {
				lines = append(lines, l)
			}
		}
		return M{"ok": true, "file": logFile(), "lines": lines}, nil
	case "/daybook":
		setFinComReading()
		x, err := getDayBookXML(fin, co, qs.Get("from"), qs.Get("to"), qint(qs, "port"))
		if err != nil {
			return nil, err
		}
		writeResp(w, 200, x, origin, "text/xml; charset=utf-8", false)
		return nil, errSent
	case "/balances":
		// 2.1.5: worked out from the copy kept here; Tally is not asked for a balance
		return heldBalances(co, qs.Get("from"), qs.Get("to"), qs.Get("open") == "1")
	case "/synced":
		mf := filepath.Join(syncFolder(co), "manifest.json")
		if exists(mf) {
			writeResp(w, 200, readText(mf), origin, "application/json; charset=utf-8", false)
			return nil, errSent
		}
		return M{"ok": true, "none": true}, nil
	case "/syncfile":
		name := qs.Get("file")
		if !re(`^(daybook-\d{6}\.xml|balances\.json|ledgers\.json)$`).MatchString(name) {
			return nil, errors.New("Not a file of the nightly copy.")
		}
		fp := filepath.Join(syncFolder(co), name)
		if !exists(fp) {
			return nil, errors.New("That is not in the nightly copy.")
		}
		ct := "text/xml; charset=utf-8"
		if strings.HasSuffix(name, ".json") {
			ct = "application/json; charset=utf-8"
		}
		writeResp(w, 200, readText(fp), origin, ct, false)
		return nil, errSent
	case "/schedule":
		if r.Method == "POST" {
			o, err := bodyObj(body)
			if err != nil {
				return nil, err
			}
			return setSchedule(truthy(o["on"]), str(o["time"]))
		}
		return getSchedule(), nil
	case "/syncnow":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return companySync(str(o["company"]), toInt(o["port"]))
	case "/fvu":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return invokeFvu(o), nil
	case "/jobs":
		if r.Method == "POST" {
			o, err := bodyObj(body)
			if err != nil {
				return nil, err
			}
			return newPostJob(o)
		}
		if id := qs.Get("id"); id != "" {
			dir, err := jobDir(id)
			if err != nil {
				return nil, err
			}
			v := jobView(dir)
			if v == nil {
				return nil, errors.New("No such job.")
			}
			return v, nil
		}
		return M{"ok": true, "jobs": activeJobs()}, nil
	case "/jobs/cancel":
		// FinCom cancels a posting (one waiting for Tally, or between batches): nothing more of it is sent
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return cancelJob(str(o["id"]), "asked by FinCom on this computer")
	case "/jobs/resume":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return resumePostJob(str(o["id"]))
	case "/ledgerlines":
		// one ledger's vouchers for a period (light); the Day Book month by month only if this Tally will not answer that way
		port, err := findCompanyPort(co, qint(qs, "port"))
		if err != nil {
			return nil, err
		}
		if lv, err := ledgerVoucherList(fin, port, co, qs.Get("ledger"), qs.Get("from"), qs.Get("to")); err == nil && lv != nil {
			a := make([]any, len(lv))
			for i, x := range lv {
				a[i] = x
			}
			return M{"ok": true, "port": port, "via": "ledger", "vouchers": a}, nil
		}
		r0, err := getVouchers(co, qs.Get("from"), qs.Get("to"), qs.Get("ledger"), "", port)
		if err != nil {
			return nil, err
		}
		r0["via"] = "daybook"
		return r0, nil
	case "/ledgerbalance":
		// 2.1.5: from the copy kept here (opening the day before from, closing on to); Tally is not asked for a balance
		return heldLedgerBalance(co, qs.Get("ledger"), qs.Get("from"), qs.Get("to"), qs.Get("only") == "close")
	case "/tags":
		port, err := findCompanyPort(co, qint(qs, "port"))
		if err != nil {
			return nil, err
		}
		heads, err := voucherHeads(fin, port, co, qs.Get("from"), qs.Get("to"))
		if err != nil {
			return nil, err
		}
		tagged := []any{}
		for _, h := range heads {
			if strings.Contains(str(h["narration"]), "TDSDesk:") {
				tagged = append(tagged, h)
			}
		}
		return M{"ok": true, "port": port, "vouchers": tagged}, nil
	case "/ledgernames":
		return getLedgerNames(fin, co, qint(qs, "port"))
	case "/tb":
		return heldTB(co, qs.Get("to"))
	case "/paircode":
		// the tray (or the FinCom Connector), which holds the key, opens a fresh connect code for FinCom on this computer
		if r.Method == "POST" {
			openPairWindow(10)
			writeLog("A new connect code was opened for 10 minutes.")
		}
		pairMu.Lock()
		defer pairMu.Unlock()
		open := time.Now().Before(pairUntil)
		code, until := "", ""
		if open {
			code, until = pairCode, pairUntil.Format("2006-01-02T15:04:05")
		}
		return M{"ok": true, "open": open, "code": code, "until": until}, nil
	case "/shutdown":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		go func() { time.Sleep(300 * time.Millisecond); writeLog("Stopping: asked to"); requestStop(1) }()
		return M{"ok": true, "stopping": true}, nil
	case "/cloudlink":
		if r.Method == "POST" {
			o, err := bodyObj(body)
			if err != nil {
				return nil, err
			}
			return setCloudLink(o)
		}
		return cloudLinkStatus(), nil
	case "/keep":
		if r.Method == "POST" {
			o, err := bodyObj(body)
			if err != nil {
				return nil, err
			}
			if v, ok := o["on"]; ok && v != nil {
				setCfg("KeepInStep", truthy(v))
			}
			if d := str(o["dailyAt"]); re(`^([01]?\d|2[0-3]):[0-5]\d$`).MatchString(d) {
				setCfg("KeepDailyAt", d)
			}
			if s := str(o["schedule"]); s == "daily" || s == "continuous" {
				setCfg("KeepSchedule", s)
			}
			saveConfig()
			if truthy(o["now"]) {
				// Update now pressed in FinCom on this computer (b): read now, also while background reading is paused
				setCfg("KeepInStep", true)
				saveConfig()
				wakeUpdate(str(o["company"]))
			}
		}
		return keepStatus(co), nil
	case "/wake":
		// FinCom on this computer: a client was opened (a), the same as the cloud's wake-up; at most one light update
		// of the company every few minutes
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		started := false
		if str(o["what"]) == "open" {
			started = wakeOpen(str(o["company"]), "opened in FinCom on this computer")
		}
		return M{"ok": true, "started": started, "paused": paused()}, nil
	case "/keepcheck":
		return testKeepMonth(co, qs.Get("ym"), qint(qs, "port"))
	// --- the tray icon's own questions
	case "/tray/status":
		return trayStatus(), nil
	case "/tray/pause":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, _ := bodyObj(body)
		setPaused(truthy(o["on"]))
		return trayStatus(), nil
	case "/tray/restart":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		go func() {
			time.Sleep(300 * time.Millisecond)
			writeLog("Restarting: asked from the tray icon")
			requestStop(3)
		}()
		return M{"ok": true, "restarting": true}, nil
	case "/tray/update":
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		return checkForUpdate(true), nil
	case "/tray/idle":
		// the tray, in the owner's Windows session, says how long the keyboard and mouse have been idle and whether Tally
		// is in front: a service cannot see that itself
		o, _ := bodyObj(body)
		setTrayIdle(num(o["idleSec"]), truthy(o["tallyFront"]))
		trayAlive(toInt(o["session"]))
		return M{"ok": true}, nil
	case "/tray/quit":
		// Quit in the tray: the service does not start the icon again in this session until the next sign-in
		o, _ := bodyObj(body)
		trayQuitSession(toInt(o["session"]))
		writeLog("The tray icon was closed (Quit); the bridge keeps running")
		return M{"ok": true}, nil
	case "/tray/check":
		// "Test connection" in the tray: Tally asked now, and a hello to FinCom's cloud with this computer's key
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		return trayCheck(), nil
	case "/tray/makemain":
		// "Switch to main bridge..." in the tray (the person said Yes): FinCom is told, then the bridge installs itself again
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		if err := switchToMain(true); err != nil {
			return nil, &httpErr{409, M{"ok": false, "error": err.Error()}}
		}
		writeLog("Switch to main bridge: asked from the tray icon")
		return M{"ok": true, "switching": true}, nil
	case "/tray/cloudkey":
		// the tray hands over bridge 1.15.0's key (protected for the Windows user, which the service cannot open)
		if err := needPost(r, "Use POST."); err != nil {
			return nil, err
		}
		o, err := bodyObj(body)
		if err != nil {
			return nil, err
		}
		return adoptCloudKey(str(o["key"]))
	}
	return nil, &httpErr{404, M{"ok": false, "error": "Unknown address " + path}}
}

// for "Test connection": which Tallys answer and with which companies; whether FinCom's cloud answers this computer's key
func trayCheck() M {
	t := M{"ok": false, "ports": []any{}, "companies": []any{}, "error": ""}
	var errs []string
	for _, s := range openCompanies(true) {
		if s["skipped"] == true {
			continue
		}
		if s["ok"] == true {
			t["ok"] = true
			t["ports"] = append(arr(t["ports"]), fmt.Sprint(toInt(s["port"])))
			for _, c := range sessCompanies(s) {
				t["companies"] = append(arr(t["companies"]), str(c["name"]))
			}
		} else if e := str(s["error"]); e != "" {
			errs = append(errs, fmt.Sprintf("port %d: %s", toInt(s["port"]), cut(e, 120)))
		}
	}
	if t["ok"] != true {
		t["error"] = strings.Join(errs, "; ")
	}
	c := M{"url": cfgS("CloudUrl") != "", "key": cloudKey() != "", "code": 0, "error": "", "firm": ""}
	if cloudOn() {
		r := invokeCloud(M{"kind": "hello", "info": M{"computer": computerName(), "user": ownerName()}}, 20)
		c["code"], c["error"] = r.code, r.err
		if r.json != nil {
			c["firm"] = str(r.json["firm"])
		}
	}
	return M{"ok": true, "tally": t, "cloud": c}
}

// this computer's bridge on a port: its /ping (no key needed), or nil when nothing answers there as a FinCom Bridge
func pingLocal(port int, timeout time.Duration) M {
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil}}
	r, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", port))
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if o := parseObj(string(b)); o != nil && str(o["impl"]) == "go" {
		return o
	}
	return nil
}

// the web server, on this computer only
func serve() (net.Listener, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", toInt(cfg("Port")))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	srv := &http.Server{Handler: http.HandlerFunc(handle), ReadHeaderTimeout: 30 * time.Second}
	srv.SetKeepAlivesEnabled(false)
	go func() { _ = srv.Serve(ln) }()
	go func() { <-stopCh; _ = srv.Close() }()
	return ln, nil
}

func computerName() string {
	if n := os.Getenv("COMPUTERNAME"); n != "" {
		return n
	}
	h, _ := os.Hostname()
	return h
}

// for FinCom: Tally open / busy / closed (a busy Tally is open, only slow to answer)
func tallyStatus(sessions []M) M {
	st, since := tallyOverall(sessions)
	return M{"state": st, "since": since}
}

// for FinCom: the heartbeat to the cloud (every 30 s), and since when it has not got through
func beatStatus() M {
	ok, fail := beatTimes()
	return M{"every": beatEvery(), "last": fmtTime(ok), "missedSince": fmtTime(fail), "on": cloudOn()}
}
