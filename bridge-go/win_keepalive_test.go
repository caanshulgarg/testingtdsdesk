//go:build windows

package main

// bridge 2.5.10: on Windows the keep-alive task goes through schtasks.exe (platSchtasks); its command line is the one
// TestR2510KeepAliveTask checks; nothing is run here
import (
	"reflect"
	"strings"
	"testing"
)

func TestR2510KeepAliveWindows(t *testing.T) {
	if reflect.ValueOf(schtasksRun).Pointer() != reflect.ValueOf(platSchtasks).Pointer() {
		t.Fatal("the task is not made with schtasks.exe")
	}
	args, err := keepAliveTaskArgs(`C:\Program Files\FinCom Bridge\FinComBridge.exe`, `C:\Users\made-up-a\AppData\Local\FinCom Bridge\tds-bridge.config.json`, pickLogin())
	if err != nil || args[len(args)-2] != "/TR" || !strings.HasSuffix(args[len(args)-1], `tds-bridge.config.json"`) || strings.Contains(strings.Join(args, " "), "/RU") {
		t.Fatalf("%v %q", err, args)
	}
}
