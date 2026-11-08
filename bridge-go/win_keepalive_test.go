//go:build windows

package main

// bridge 2.5.10: on Windows the keep-alive task goes through schtasks.exe (platSchtasks) from Task Scheduler's own file,
// as this Windows user (its SID, InteractiveToken: accepted without a password or an administrator, also on battery),
// and the bridge it starts runs at normal priority; nothing is run here
import (
	"reflect"
	"strings"
	"testing"
)

func TestR2510KeepAliveWindows(t *testing.T) {
	if reflect.ValueOf(schtasksRun).Pointer() != reflect.ValueOf(platSchtasks).Pointer() {
		t.Fatal("the task is not made with schtasks.exe")
	}
	sid := platUserSID()
	if !strings.HasPrefix(sid, "S-1-") {
		t.Fatalf("this user's SID: %q", sid)
	}
	x, err := keepAliveTaskXML(`C:\Program Files\FinCom Bridge\FinComBridge.exe`, `C:\Users\made-up-a\AppData\Local\FinCom Bridge\tds-bridge.config.json`, sid)
	if err != nil || !strings.Contains(x, "<UserId>"+sid+"</UserId>") || !strings.Contains(x, "<LogonType>InteractiveToken</LogonType>") ||
		!strings.Contains(x, "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>") || strings.Contains(x, "Password") {
		t.Fatalf("%v\n%s", err, x)
	}
	a := keepAliveCreateArgs(keepAliveTaskName(ownerName(), sid), `C:\x.xml`)
	if strings.Contains(strings.Join(a, " "), "/RU") || strings.Contains(strings.Join(a, " "), "/RP") || a[len(a)-2] != "/XML" {
		t.Fatalf("the create: %q", a)
	}
	if normalPriorityClass != 0x20 {
		t.Fatal("NORMAL_PRIORITY_CLASS")
	}
}
