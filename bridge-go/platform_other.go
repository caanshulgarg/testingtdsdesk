//go:build !windows

// Not Windows: only for the tests (the stand-in Tally and cloud), where processes, ports and users come from the test
// file and the key is kept as plain text.
package main

import (
	"os"
	"os/exec"
	"strings"
)

func platNetState() (bool, []proc, []listener) { return false, nil, nil }
func platSessionUsers() map[int]string         { return map[int]string{} }
func platMySessions() []int                    { return []int{0} }
func platIdleSec() float64                     { return 99999 }
func platFrontIsTally() bool                   { return false }
func platTallyYoung(min float64) bool          { return false }
func lockSharedMutex(port int) func()          { return func() {} }
func keepAwake(on bool)                        {}
func hideWindow(c *exec.Cmd)                   {}
func oldBridgePresent() bool                   { return false }

func protectKey(k string) (string, error) { return "plain:" + k, nil }
func unprotectKey(v string) string {
	switch {
	case strings.HasPrefix(v, "plain:"):
		return v[6:]
	case strings.HasPrefix(v, "dpapi:"), strings.HasPrefix(v, "dpapim:"):
		return ""
	}
	return v
}
func ownerName() string {
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	return os.Getenv("USERNAME")
}
func ownerProfile() string { h, _ := os.UserHomeDir(); return h }

func runService(args []string) int   { return runBridge(true) }
func isWindowsService() bool         { return false }
func runTray(args []string) int      { println("The tray icon is for Windows."); return 1 }
func installCmd(args []string) int   { println("Installing is for Windows."); return 1 }
func uninstallCmd(args []string) int { println("Removing is for Windows."); return 1 }
func notify(title, text string)      {}
func applyUpdate(exe string, b []byte) error {
	return os.WriteFile(exe+".new", b, 0o755)
}

func defaultHome() string               { return "" }
func checkCodeSignature(b []byte) error { return errNoCodeSign }
func trayAlive(session int)             {}
func trayQuitSession(session int)       {}
func openFile(f string)                 { println(f) }
func attachConsole()                    {}
func stopCmd() int                      { return 0 }
func restartServiceCmd() int            { return 0 }
