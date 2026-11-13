//go:build windows

// FinCom Bridge 2.5.16 (fvu.go): on Windows a drive letter that is a network drive is a network location, and under the
// service the FVU runs in the owner's signed-in session with the owner's rights, never as SYSTEM.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// a path on a network drive (a mapped letter)
func platRemotePath(p string) bool {
	v := filepath.VolumeName(p)
	if len(v) != 2 || v[1] != ':' {
		return false
	}
	root, err := windows.UTF16PtrFromString(v + `\`)
	if err != nil {
		return true
	}
	return windows.GetDriveType(root) == windows.DRIVE_REMOTE
}

// the owner's token from a session the owner is signed in to (active first), checked to be the owner's own SID
func ownerSessionToken() (windows.Token, error) {
	want := serviceOwnerSid()
	if want == "" {
		return 0, errors.New("the Windows user this bridge works for is not recorded")
	}
	var tries []sessInfo
	for _, s := range sessions() {
		if s.id != 0 && s.state == windows.WTSActive && sameUser(s.user, ownerName()) {
			tries = append(tries, s)
		}
	}
	for _, s := range sessions() {
		if s.id != 0 && s.state == windows.WTSDisconnected && sameUser(s.user, ownerName()) {
			tries = append(tries, s)
		}
	}
	for _, s := range tries {
		var tok windows.Token
		if windows.WTSQueryUserToken(uint32(s.id), &tok) != nil {
			continue
		}
		if u, err := tok.GetTokenUser(); err == nil && u.User.Sid.String() == want {
			return tok, nil
		}
		tok.Close()
	}
	return 0, errors.New("not signed in")
}

// the run handed to FinComBridge.exe fvu-run in the owner's session, with the owner's rights and environment
func platFvuRunAsOwner(q fvuReq) M {
	tok, err := ownerSessionToken()
	if err != nil {
		return M{"ok": false, "needSignIn": true, "error": "The FVU runs only with the rights of " + ownerName() + ", never as Windows itself: sign in to this computer as " + ownerName() + " (FinCom Bridge's icon near the clock shows), then try again."}
	}
	defer tok.Close()
	env, _ := tok.Environ(false)
	exe, err := os.Executable()
	if err != nil {
		return M{"ok": false, "error": "The FVU could not be started: " + err.Error()}
	}
	b, _ := json.Marshal(q)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, exe, "fvu-run")
	c.Env = env
	c.Dir = filepath.Dir(q.Out)
	c.Stdin = bytes.NewReader(b)
	var out bytes.Buffer
	c.Stdout = &out
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000, Token: syscall.Token(tok)}
	if err := c.Run(); err != nil && out.Len() == 0 {
		return M{"ok": false, "error": "The FVU could not be started for " + ownerName() + ": " + err.Error()}
	}
	if r := parseObj(out.String()); r != nil {
		return r
	}
	return M{"ok": false, "error": "The FVU run gave no answer."}
}
