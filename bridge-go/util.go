// FinCom Bridge (Go): the Windows service that connects TallyPrime on this computer with FinCom.
// It does what the PowerShell bridge 1.15.0 (bridge/TDSBridge.ps1) does, with the same files on disk, the same local
// addresses for FinCom (127.0.0.1:9100) and the same calls to FinCom's cloud, so FinCom works with either.
// This file: small helpers used everywhere.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var BridgeVersion = "2.3.2" // set at build time for test builds (-X main.BridgeVersion=...)

// M is a JSON object, as PowerShell's [ordered]@{} was
type M = map[string]any

func jsonText(v any) string {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(v)
	return strings.TrimRight(b.String(), "\n")
}

func parseJSON(s string) (any, error) {
	var v any
	d := json.NewDecoder(strings.NewReader(strings.TrimPrefix(s, "\ufeff")))
	d.UseNumber()
	if err := d.Decode(&v); err != nil {
		return nil, err
	}
	return normNumbers(v), nil
}

// numbers read as float64 (whole numbers stay whole when written again)
func normNumbers(v any) any {
	switch x := v.(type) {
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return float64(i)
		}
		f, _ := x.Float64()
		return f
	case map[string]any:
		for k, e := range x {
			x[k] = normNumbers(e)
		}
		return x
	case []any:
		for i, e := range x {
			x[i] = normNumbers(e)
		}
		return x
	}
	return v
}

func parseObj(s string) M {
	v, err := parseJSON(s)
	if err != nil {
		return nil
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func readJSONFile(f string) any {
	b, err := os.ReadFile(f)
	if err != nil {
		return nil
	}
	v, err := parseJSON(string(b))
	if err != nil {
		return nil
	}
	return v
}

func readObjFile(f string) M {
	if m, ok := readJSONFile(f).(map[string]any); ok {
		return m
	}
	return nil
}

// --- loose reading of values (PowerShell's [string], [int], [bool] casts)
func str(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case bool:
		if x {
			return "True"
		}
		return "False"
	case []any:
		p := make([]string, 0, len(x))
		for _, e := range x {
			p = append(p, str(e))
		}
		return strings.Join(p, " ")
	}
	return fmt.Sprint(v)
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err == nil {
			return f
		}
	}
	return 0
}
func toInt(v any) int   { return int(num(v)) }
func toI64(v any) int64 { return int64(num(v)) }
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	case []any:
		return len(x) > 0
	case map[string]any:
		return true
	}
	return true
}
func arr(v any) []any {
	switch x := v.(type) {
	case nil:
		return nil
	case []any:
		return x
	case []string:
		o := make([]any, len(x))
		for i, s := range x {
			o[i] = s
		}
		return o
	}
	return []any{v}
}
func obj(v any) M {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}
func strs(v any) []string {
	var o []string
	for _, e := range arr(v) {
		if s := str(e); s != "" {
			o = append(o, s)
		}
	}
	return o
}
func uniqSorted(a []string) []string {
	m := map[string]bool{}
	var o []string
	for _, s := range a {
		if s != "" && !m[s] {
			m[s] = true
			o = append(o, s)
		}
	}
	sort.Strings(o)
	return o
}
func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}

// --- files
// written whole, then moved into place, so a reader never sees half a file (Save-KeepFile)
// the rename that puts a saved file in place (a function so the tests can refuse it). os.Rename replaces the old file
// in one step: MoveFileEx with MOVEFILE_REPLACE_EXISTING on Windows, rename(2) elsewhere
var renameFn = os.Rename

// a file written whole: the text in a temporary file beside it, then put in place by one rename. Round 20 (the
// re-review's Low 2): the old file is never removed first; a rename refused (an antivirus or a backup holding the file)
// is tried again a few times, and if it still fails the old file stays as it was and the temporary file goes
func saveFile(path, text string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	var err error
	for i := 0; i < 4; i++ {
		if err = renameFn(tmp, path); err == nil {
			return nil
		}
		time.Sleep(time.Duration(i+1) * 50 * time.Millisecond)
	}
	_ = os.Remove(tmp)
	return err
}
func readText(f string) string {
	b, err := os.ReadFile(f)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(string(b), "\ufeff")
}
func exists(f string) bool { _, err := os.Stat(f); return err == nil }
func mtime(f string) (time.Time, bool) {
	fi, err := os.Stat(f)
	if err != nil {
		return time.Time{}, false
	}
	return fi.ModTime(), true
}
func appendText(f, s string) error {
	_ = os.MkdirAll(filepath.Dir(f), 0o755)
	h, err := os.OpenFile(f, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer h.Close()
	_, err = h.WriteString(s)
	return err
}

// --- Tally's dates: yyyyMMdd
func isTallyDate(d string) bool { return regexp.MustCompile(`^\d{8}$`).MatchString(d) }
func fromTallyDate(d string) time.Time {
	t, err := time.ParseInLocation("20060102", d, time.Local)
	if err != nil {
		return time.Time{}
	}
	return t
}
func tallyDate(t time.Time) string   { return t.Format("20060102") }
func addDays(d string, n int) string { return tallyDate(fromTallyDate(d).AddDate(0, 0, n)) }
func today() string                  { return tallyDate(time.Now()) }
func nowS() string                   { return time.Now().Format("2006-01-02T15:04:05") }
func fyStart(t time.Time) time.Time {
	y := t.Year()
	if t.Month() < 4 {
		y--
	}
	return time.Date(y, 4, 1, 0, 0, 0, 0, time.Local)
}
func monthEnd(ym string) string { return tallyDate(fromTallyDate(ym+"01").AddDate(0, 1, -1)) }
func nextYm(ym string) string   { return fromTallyDate(ym+"01").AddDate(0, 1, 0).Format("200601") }
func parseTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, f := range []string{"2006-01-02T15:04:05", time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.9999999Z07:00", "2006-01-02T15:04:05.9999999"} {
		if t, err := time.ParseInLocation(f, s, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
func dayRange(a, b string) []string {
	var o []string
	for d := a; d <= b; d = addDays(d, 1) {
		o = append(o, d)
	}
	return o
}

// XML text escaped as the bridge always did (Esc)
func esc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&#34;", "'", "&#39;")
	return r.Replace(s)
}

// a company's name as one folder name inside the sync folder: the characters Windows does not allow in a name (the path
// separators among them) become "_" as always; a name that is empty, ".", "..", starts with a dot or carries a control
// character is refused, so a company's folder never leaves the sync folder
func safeName(s string) (string, error) {
	n := strings.TrimSpace(regexp.MustCompile(`[\\/:*?"<>|]`).ReplaceAllString(s, "_"))
	switch {
	case n == "":
		return "", errors.New("A company with no name has no folder of its own on this computer.")
	case n == "." || n == ".." || strings.HasPrefix(n, "."):
		return "", fmt.Errorf("The company name %q cannot be a folder name on this computer (it starts with a dot).", s)
	case strings.IndexFunc(n, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0:
		return "", fmt.Errorf("The company name %q carries a control character and cannot be a folder name on this computer.", s)
	case strings.ContainsAny(n, `/\`) || filepath.Base(n) != n:
		return "", fmt.Errorf("The company name %q cannot be a folder name on this computer.", s)
	}
	return n, nil
}

func minI(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func maxI(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func cut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

var reCache = map[string]*regexp.Regexp{}

func re(p string) *regexp.Regexp {
	reMu.Lock()
	defer reMu.Unlock()
	if r, ok := reCache[p]; ok {
		return r
	}
	r := regexp.MustCompile(p)
	reCache[p] = r
	return r
}
func group(p, s string, i int) string {
	m := re(p).FindStringSubmatch(s)
	if m == nil || len(m) <= i {
		return ""
	}
	return m[i]
}

// --name value or --name=value from a command's arguments
func flagValue(args []string, name string) string {
	for i, a := range args {
		if a == "--"+name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(a, "--"+name+"=") {
			return strings.TrimPrefix(a, "--"+name+"=")
		}
	}
	return ""
}

// the first map that is not nil
func or2(a, b M) M {
	if a != nil {
		return a
	}
	return b
}
