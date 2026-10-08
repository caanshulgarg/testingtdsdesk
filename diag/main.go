//go:build windows

// Diagnostic only (not shipped): why FinCom Bridge's own-user check (bridge-go/ownuser.go + win_peer.go) says
// "yours": false to the user's own browser.
//
//	diag serve -out results.txt     page on http://localhost:8000 (the test page), POST /result, and a mirror of the
//	                                bridge's check on 127.0.0.1:9101 that reports every detail about the peer
//	diag procs name.exe ...         every process of those names: integrity, AppContainer, open errors, command line
//	diag inspect PID
//	diag self
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modIphlpapi          = windows.NewLazySystemDLL("iphlpapi.dll")
	pGetExtendedTcpTable = modIphlpapi.NewProc("GetExtendedTcpTable")
	modWts               = windows.NewLazySystemDLL("wtsapi32.dll")
	pWTSEnumProcEx       = modWts.NewProc("WTSEnumerateProcessesExW")
	modAdv               = windows.NewLazySystemDLL("advapi32.dll")
	pIsTokenRestricted   = modAdv.NewProc("IsTokenRestricted")
)

type tcpRow struct{ State, LocalAddr, LocalPort, RemoteAddr, RemotePort, Pid uint32 }

type tcp6Row struct {
	LocalAddr          [16]byte
	LocalScope, LPort  uint32
	RemoteAddr         [16]byte
	RemoteScope, RPort uint32
	State, Pid         uint32
}

func netPort(v uint32) int { return int((v&0xff)<<8 | (v>>8)&0xff) }

func rawTable(af uint32) ([]byte, error) {
	size := uint32(64 * 1024)
	for i := 0; i < 8; i++ {
		buf := make([]byte, size)
		r, _, _ := pGetExtendedTcpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, uintptr(af), 5, 0)
		if r == uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
			size += 8192
			continue
		}
		if r != 0 {
			return nil, windows.Errno(r)
		}
		return buf, nil
	}
	return nil, errors.New("table kept growing")
}

func tcp4() []tcpRow {
	buf, err := rawTable(windows.AF_INET)
	if err != nil {
		return nil
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	sz := uint32(unsafe.Sizeof(tcpRow{}))
	out := make([]tcpRow, n)
	for k := uint32(0); k < n; k++ {
		out[k] = *(*tcpRow)(unsafe.Pointer(&buf[4+k*sz]))
	}
	return out
}

func tcp6() []tcp6Row {
	buf, err := rawTable(windows.AF_INET6)
	if err != nil {
		return nil
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	sz := uint32(unsafe.Sizeof(tcp6Row{}))
	out := make([]tcp6Row, n)
	for k := uint32(0); k < n; k++ {
		out[k] = *(*tcp6Row)(unsafe.Pointer(&buf[4+k*sz]))
	}
	return out
}

// exactly the bridge's peerPidFrom
func peerPid(rows []tcpRow, serverPort, clientPort int) int {
	const loopback = 0x0100007f
	for _, r := range rows {
		if r.LocalAddr == loopback && netPort(r.LocalPort) == clientPort && netPort(r.RemotePort) == serverPort {
			return int(r.Pid)
		}
	}
	return 0
}

type procEntry struct {
	PPid int
	Name string
}

func snapshot() map[int]procEntry {
	m := map[int]procEntry{}
	h, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return m
	}
	defer windows.CloseHandle(h)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(h, &e); err == nil; err = windows.Process32Next(h, &e) {
		m[int(e.ProcessID)] = procEntry{int(e.ParentProcessID), windows.UTF16ToString(e.ExeFile[:])}
	}
	return m
}

type wtsProcInfoEx struct {
	SessionId, ProcessId uint32
	Name                 *uint16
	Sid                  *windows.SID
	A, B, C, D, E, F     uint32
	UserTime, KernelTime int64
}

// the user SID of every process as WTSEnumerateProcessesEx reports it (no handle to the process needed)
func wtsSIDs() (map[int]string, error) {
	level := uint32(1)
	var p uintptr
	var count uint32
	r, _, e := pWTSEnumProcEx.Call(0, uintptr(unsafe.Pointer(&level)), uintptr(0xFFFFFFFE), uintptr(unsafe.Pointer(&p)), uintptr(unsafe.Pointer(&count)))
	if r == 0 {
		return nil, e
	}
	m := map[int]string{}
	sz := unsafe.Sizeof(wtsProcInfoEx{})
	for i := uint32(0); i < count; i++ {
		pi := (*wtsProcInfoEx)(unsafe.Pointer(p + uintptr(i)*sz))
		if pi.Sid != nil {
			m[int(pi.ProcessId)] = pi.Sid.String()
		} else {
			m[int(pi.ProcessId)] = "(nil sid)"
		}
	}
	return m, nil
}

type Info struct {
	Pid, PPid        int
	Name, ParentName string
	Session          string
	OpenLimited      string // error of OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) or "ok"
	OpenQueryInfo    string // error of OpenProcess(PROCESS_QUERY_INFORMATION)
	TokQuery         string // error of OpenProcessToken(TOKEN_QUERY)
	TokQuerySource   string // error of OpenProcessToken(TOKEN_QUERY_SOURCE)
	User             string
	Integrity        string
	AppContainer     string
	Restricted       string
	Elevated         string
	WTSUser          string
	BridgeWouldSay   string
	CmdLine          string
}

func errS(err error) string {
	if err == nil {
		return "ok"
	}
	var en windows.Errno
	if errors.As(err, &en) {
		return fmt.Sprintf("%v (%d)", err, uint32(en))
	}
	return err.Error()
}

func integrityName(rid uint32) string {
	switch {
	case rid < 0x1000:
		return fmt.Sprintf("Untrusted(0x%x)", rid)
	case rid < 0x2000:
		return fmt.Sprintf("Low(0x%x)", rid)
	case rid < 0x2100:
		return fmt.Sprintf("Medium(0x%x)", rid)
	case rid < 0x3000:
		return fmt.Sprintf("MediumPlus(0x%x)", rid)
	case rid < 0x4000:
		return fmt.Sprintf("High(0x%x)", rid)
	default:
		return fmt.Sprintf("System(0x%x)", rid)
	}
}

func tokenDetails(tok windows.Token, in *Info) {
	if u, err := tok.GetTokenUser(); err == nil {
		in.User = u.User.Sid.String()
	} else {
		in.User = "err " + errS(err)
	}
	buf := make([]byte, 256)
	var n uint32
	if err := windows.GetTokenInformation(tok, windows.TokenIntegrityLevel, &buf[0], uint32(len(buf)), &n); err == nil {
		tml := (*windows.Tokenmandatorylabel)(unsafe.Pointer(&buf[0]))
		sid := tml.Label.Sid
		in.Integrity = integrityName(sid.SubAuthority(uint32(sid.SubAuthorityCount()) - 1))
	} else {
		in.Integrity = "err " + errS(err)
	}
	var ac uint32
	if err := windows.GetTokenInformation(tok, 29 /* TokenIsAppContainer */, (*byte)(unsafe.Pointer(&ac)), 4, &n); err == nil {
		in.AppContainer = fmt.Sprint(ac != 0)
	} else {
		in.AppContainer = "err " + errS(err)
	}
	r, _, _ := pIsTokenRestricted.Call(uintptr(tok))
	in.Restricted = fmt.Sprint(r != 0)
	in.Elevated = fmt.Sprint(tok.IsElevated())
}

func cmdLine(h windows.Handle) string {
	buf := make([]byte, 64*1024)
	var n uint32
	if err := windows.NtQueryInformationProcess(h, 60, unsafe.Pointer(&buf[0]), uint32(len(buf)), &n); err != nil {
		return "err " + errS(err)
	}
	s := (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0])).String()
	if len(s) > 400 {
		s = s[:400] + "..."
	}
	return s
}

// the bridge's exact processSID
func bridgeSID(pid int) (string, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		return "", err
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return "", err
	}
	return u.User.Sid.String(), nil
}

func ownSID() string {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return ""
	}
	return u.User.Sid.String()
}

func inspect(pid int, snap map[int]procEntry, wts map[int]string) Info {
	in := Info{Pid: pid}
	if snap == nil {
		snap = snapshot()
	}
	if e, ok := snap[pid]; ok {
		in.Name, in.PPid = e.Name, e.PPid
		in.ParentName = snap[e.PPid].Name
	}
	var sess uint32
	if err := windows.ProcessIdToSessionId(uint32(pid), &sess); err == nil {
		in.Session = fmt.Sprint(sess)
	} else {
		in.Session = "err " + errS(err)
	}
	if wts != nil {
		in.WTSUser = wts[pid]
	}
	if h, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, uint32(pid)); err == nil {
		in.OpenQueryInfo = "ok"
		windows.CloseHandle(h)
	} else {
		in.OpenQueryInfo = errS(err)
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	in.OpenLimited = errS(err)
	if err == nil {
		defer windows.CloseHandle(h)
		in.CmdLine = cmdLine(h)
		var t2 windows.Token
		if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY_SOURCE, &t2); err == nil {
			in.TokQuerySource = "ok"
			t2.Close()
		} else {
			in.TokQuerySource = errS(err)
		}
		var tok windows.Token
		err = windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok)
		in.TokQuery = errS(err)
		if err == nil {
			tokenDetails(tok, &in)
			tok.Close()
		}
	}
	sid, berr := bridgeSID(pid)
	switch {
	case errors.Is(berr, windows.ERROR_ACCESS_DENIED):
		in.BridgeWouldSay = "yours=false: has no Windows user (ACCESS_DENIED treated as another user's)"
	case berr != nil:
		in.BridgeWouldSay = "yours=false: could not be told: " + berr.Error()
	case strings.EqualFold(sid, ownSID()):
		in.BridgeWouldSay = "yours=true"
	default:
		in.BridgeWouldSay = "yours=false: other SID " + sid
	}
	return in
}

func pj(v any) string { b, _ := json.MarshalIndent(v, "", "  "); return string(b) }

var outMu sync.Mutex
var outFile string

func emit(s string) {
	outMu.Lock()
	defer outMu.Unlock()
	fmt.Println(s)
	if outFile != "" {
		if f, err := os.OpenFile(outFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o666); err == nil {
			f.WriteString(s + "\n")
			f.Close()
		}
	}
}

const page = `<!doctype html><meta charset=utf-8><title>diag</title><pre id=o>running</pre><script>
const label = new URLSearchParams(location.search).get('c') || 'unknown';
const n = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
async function get(u) { try { const r = await fetch(u, {cache: 'no-store'}); return {url: u, status: r.status, body: await r.text()}; } catch (e) { return {url: u, err: String(e)}; } }
(async () => {
  const out = [];
  out.push(await get('http://127.0.0.1:9100/ping?n=' + n));
  out.push(await get('http://127.0.0.1:9101/inspect?n=' + n));
  out.push(await get('http://127.0.0.1:9100/status'));
  out.push(await get('http://localhost:9100/ping?n=' + n));
  out.push(await get('http://localhost:9101/inspect?via=localhost'));
  const body = JSON.stringify({client: label, ua: navigator.userAgent, out});
  document.getElementById('o').textContent = body;
  try { await fetch('/result?c=' + encodeURIComponent(label), {method: 'POST', body}); } catch (e) {}
  document.title = 'done';
})();
</script>`

func serve() {
	ownS := ownSID()
	emit("diag serve: own SID " + ownS + "; self " + pj(inspect(os.Getpid(), nil, nil)))
	pageMux := http.NewServeMux()
	pageMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, page)
	})
	pageMux.HandleFunc("/result", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		emit("RESULT " + r.URL.Query().Get("c") + " " + string(b))
	})
	for _, a := range []string{"127.0.0.1:8000", "[::1]:8000"} {
		if ln, err := net.Listen("tcp", a); err == nil {
			go http.Serve(ln, pageMux)
		} else {
			emit("listen " + a + ": " + err.Error())
		}
	}
	mirror := http.NewServeMux()
	mirror.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		local, remote := 0, 0
		if a, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
			_, p, _ := net.SplitHostPort(a.String())
			local, _ = strconv.Atoi(p)
		}
		host, p, _ := net.SplitHostPort(r.RemoteAddr)
		remote, _ = strconv.Atoi(p)
		rows := tcp4()
		pid := peerPid(rows, local, remote)
		res := map[string]any{"remoteAddr": r.RemoteAddr, "host": host, "localPort": local, "clientPort": remote, "ipv4Rows": len(rows), "pid": pid, "ua": r.UserAgent(), "origin": r.Header.Get("Origin")}
		// every row (v4 and v6) involving the client port, to see a broker or a v6 row
		var v4m, v6m []string
		for _, x := range rows {
			if netPort(x.LocalPort) == remote || netPort(x.RemotePort) == remote {
				v4m = append(v4m, fmt.Sprintf("st=%d l=%08x:%d r=%08x:%d pid=%d", x.State, x.LocalAddr, netPort(x.LocalPort), x.RemoteAddr, netPort(x.RemotePort), x.Pid))
			}
		}
		for _, x := range tcp6() {
			if netPort(x.LPort) == remote || netPort(x.RPort) == remote {
				v6m = append(v6m, fmt.Sprintf("st=%d l=%x:%d r=%x:%d pid=%d", x.State, x.LocalAddr, netPort(x.LPort), x.RemoteAddr, netPort(x.RPort), x.Pid))
			}
		}
		res["v4match"], res["v6match"] = v4m, v6m
		if pid != 0 {
			wts, werr := wtsSIDs()
			if werr != nil {
				res["wtsErr"] = werr.Error()
			}
			res["peer"] = inspect(pid, nil, wts)
		}
		emit("MIRROR " + r.URL.String() + " " + pj(res))
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, pj(res))
	})
	ln, err := net.Listen("tcp", "127.0.0.1:9101")
	if err != nil {
		emit("listen 9101: " + err.Error())
		os.Exit(1)
	}
	http.Serve(ln, mirror)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("diag serve|procs|inspect|self")
		os.Exit(2)
	}
	for i, a := range os.Args {
		if a == "-out" && i+1 < len(os.Args) {
			outFile = os.Args[i+1]
		}
	}
	switch os.Args[1] {
	case "serve":
		serve()
	case "acrun":
		acRun(os.Args[2], len(os.Args) > 3 && os.Args[3] == "lpac")
	case "fetch":
		fetch(os.Args[2])
	case "self":
		emit(pj(inspect(os.Getpid(), nil, nil)))
	case "inspect":
		pid, _ := strconv.Atoi(os.Args[2])
		wts, _ := wtsSIDs()
		emit(pj(inspect(pid, nil, wts)))
	case "procs":
		snap := snapshot()
		wts, werr := wtsSIDs()
		if werr != nil {
			emit("WTSEnumerateProcessesEx: " + werr.Error())
		}
		emit("procs as " + ownSID())
		names := map[string]bool{}
		for _, n := range os.Args[2:] {
			if n != "-out" && !strings.HasSuffix(n, ".txt") {
				names[strings.ToLower(n)] = true
			}
		}
		for pid, e := range snap {
			if names[strings.ToLower(e.Name)] {
				in := inspect(pid, snap, wts)
				emit(fmt.Sprintf("PROC pid=%d ppid=%d %s sess=%s openLtd=%s tokQuery=%s tokQSrc=%s IL=%s AC=%s restricted=%s user=%s wts=%s bridge=%q cmd=%q",
					in.Pid, in.PPid, in.Name, in.Session, in.OpenLimited, in.TokQuery, in.TokQuerySource, in.Integrity, in.AppContainer, in.Restricted, in.User, in.WTSUser, in.BridgeWouldSay, in.CmdLine))
			}
		}
	}
}
