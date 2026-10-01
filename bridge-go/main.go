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
// FinComBridge.exe install --mode test|sole   (the installer runs this) the service, its owner, the settings
// FinComBridge.exe uninstall             (the uninstaller runs this)
// FinComBridge.exe compare               this bridge's copy against bridge 1.15.0's, day by day
// FinComBridge.exe sync                  the nightly copy (scheduled task)
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
	_ = fs.Bool("quiet", false, "")
	_ = fs.Parse(rest)
	switch cmd {
	case "version":
		fmt.Println(BridgeVersion)
		return
	case "tray":
		os.Exit(runTray(rest))
	case "install":
		os.Exit(installCmd(rest))
	case "uninstall":
		os.Exit(uninstallCmd(rest))
	}
	setPaths(*config, *home)
	switch cmd {
	case "compare":
		loadConfig()
		logEcho = false
		os.Exit(compareCopies(fs.Args()))
	case "sync":
		loadConfig()
		r := nightlySync()
		fmt.Printf("Nightly copy: %d done, %d failed.\n", len(arr(r["done"])), len(arr(r["failed"])))
		return
	case "run":
		os.Exit(runBridge(true))
	case "", "service":
		if isWindowsService() {
			os.Exit(runService(rest))
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
