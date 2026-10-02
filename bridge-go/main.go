package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FinComBridge.exe                       on Windows started by Windows as a service (or in a window, for support)
// FinComBridge.exe run [--config F]      in this window (Ctrl+C stops it)
// FinComBridge.exe tray                  the tray icon, in the signed-in user's session
// FinComBridge.exe user (or --user)      just for this Windows user (no administrator, no service), started at sign-in:
// it keeps the bridge (its worker) and the tray icon running, one of each per user
// FinComBridge.exe worker (or --worker)  the bridge itself, started by "user" (not by hand)
// FinComBridge.exe install --mode test|sole [--per-user]   (the installer runs this) the service, its owner, the
// settings; with --per-user the start at sign-in instead of the service. It writes install-result.txt for the setup
// (%LOCALAPPDATA%\FinCom Bridge) and ends with 4 when the bridge did not answer within 30 seconds
// FinComBridge.exe stop [--per-user]     (the installer runs this) stops the service, or this user's bridge
// FinComBridge.exe uninstall [--per-user] [--keep-pairing]  (the uninstaller runs this) the service or the start at
// sign-in, and the bridge's own files (its pairing with FinCom kept if asked)
// FinComBridge.exe sendlog [--fincom U]  the install log (and the bridge's log, settings without keys) to FinCom support
// FinComBridge.exe compare               this bridge's copy against bridge 1.15.0's, day by day
// FinComBridge.exe sync                  (retired: the old nightly copy task; it now only removes that task)
// FinComBridge.exe measure --company C [--out F] [--ledgers 696-699] | --snapshot L [--month yyyymm] | --compare L1 L2
//                                        Tally measured for FinCom support (measure.go)
// FinComBridge.exe version
// The PowerShell bridge's own arguments work too (-ConfigPath F, -Sync), so its tests run this bridge unchanged.
func main() {
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = strings.ToLower(args[0]), args[1:]
	}
	// PowerShell style: -ConfigPath X, -Sync, -Keep
	var rest []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch strings.ToLower(a) {
		case "-configpath":
			if i+1 < len(args) {
				rest = append(rest, "--config", args[i+1])
				i++
			}
		case "-sync":
			cmd = "sync"
		default:
			rest = append(rest, a)
		}
	}
	fs := flag.NewFlagSet("bridge", flag.ContinueOnError)
	config := fs.String("config", "", "settings file")
	home := fs.String("home", "", "the bridge's folder")
	_ = fs.Bool("service", false, "")
	_ = fs.String("mode", "", "")
	_ = fs.String("fincom", "", "")
	for _, f := range []string{"company", "out", "ledgers", "snapshot", "month", "compare"} {
		_ = fs.String(f, "", "measure") // FinComBridge.exe measure ... (read again by measureCmd)
	}
	_ = fs.Bool("quiet", false, "")
	_ = fs.Bool("show", false, "")
	userFlag := fs.Bool("user", false, "run just for this Windows user: the bridge and the tray icon, kept running")
	workerFlag := fs.Bool("worker", false, "the bridge under --user")
	_ = fs.Bool("keep-pairing", false, "uninstall: keep this computer's pairing with FinCom")
	_ = fs.Bool("per-user", false, "install, uninstall, stop: the install just for this Windows user")
	_ = fs.String("parent", "", "worker: the supervisor's process (the worker ends with it)")
	_ = fs.Parse(rest)
	if cmd == "" && *userFlag {
		cmd = "user"
	}
	if cmd == "" && *workerFlag {
		cmd = "worker"
	}
	switch cmd {
	case "", "service", "tray", "install", "uninstall", "stop", "restart-service", "user", "worker":
	default:
		attachConsole() // the program is a windowed one (no console flashes for the tray): commands typed in a window print there
	}
	switch cmd {
	case "version":
		fmt.Println(BridgeVersion)
		return
	case "stop":
		os.Exit(stopCmd(rest))
	case "restart-service":
		os.Exit(restartServiceCmd())
	case "tray":
		os.Exit(runTray(rest))
	case "install":
		os.Exit(installCmd(rest))
	case "uninstall":
		os.Exit(uninstallCmd(rest))
	}
	setPaths(*config, *home)
	switch cmd {
	case "sendlog":
		os.Exit(sendLogCmd(rest))
	case "log":
		loadConfigRO()
		openFile(logFile())
		return
	case "compare":
		loadConfigRO()
		logEcho = false
		code := compareCopies(fs.Args())
		if contains(rest, "--show") {
			openFile(filepath.Join(Home, "compare-report.txt"))
		}
		os.Exit(code)
	case "measure":
		os.Exit(measureCmd(rest))
	case "sync":
		loadConfig()
		r := nightlySync()
		fmt.Printf("Nightly copy: %d done, %d failed.\n", len(arr(r["done"])), len(arr(r["failed"])))
		return
	case "run":
		os.Exit(runBridge(true))
	case "service":
		os.Exit(runService(rest)) // Windows starts it as "FinComBridge.exe service --config ..."
	case "user":
		os.Exit(runUser(rest)) // the start at sign-in: HKCU\...\Run runs "FinComBridge.exe user"
	case "worker":
		os.Exit(runWorker(rest))
	case "":
		if isWindowsService() {
			os.Exit(runService(rest))
		}
		// installed just for this user: a double-click on the program starts it the same way as at sign-in
		if perUserInstall() {
			os.Exit(runUser(rest))
		}
		os.Exit(runBridge(true))
	default:
		fmt.Println("Unknown command: " + cmd)
		os.Exit(2)
	}
}

// the settings file and the bridge's folder: given, or the installed ones, or beside this program
func setPaths(config, home string) {
	if config == "" {
		config = os.Getenv("FINCOM_BRIDGE_CONFIG")
	}
	// the install's record names its settings (in test mode go-bridge.config.json; switched to main, bridge 1.15.0's)
	if c := installedConfig(); config == "" && c != "" && exists(c) {
		config = c
	}
	if config == "" {
		if h := defaultHome(); h != "" {
			config = filepath.Join(h, "tds-bridge.config.json")
			if exists(filepath.Join(h, "go-bridge.config.json")) {
				config = filepath.Join(h, "go-bridge.config.json")
			}
		} else {
			wd, _ := os.Getwd()
			config = filepath.Join(wd, "tds-bridge.config.json")
		}
	}
	config, _ = filepath.Abs(config)
	ConfigPath = config
	if home == "" {
		home = filepath.Dir(config)
	}
	Home, _ = filepath.Abs(home)
}
