//go:build windows

// 2.2.2: a small input dialog for the tray ("Test fetching an entry" asks a voucher's type, number and date, and a
// MasterID when none was found): a caption, one line of text with its default selected, OK and Cancel. Its own window
// on its own thread, one at a time; Enter is OK, Esc is Cancel.
package main

import (
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	gdi32                = windows.NewLazySystemDLL("gdi32.dll")
	pGetStockObject      = gdi32.NewProc("GetStockObject")
	pDestroyWindow       = user32.NewProc("DestroyWindow")
	pGetWindowText       = user32.NewProc("GetWindowTextW")
	pGetWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	pSendMessage         = user32.NewProc("SendMessageW")
	pIsDialogMessage     = user32.NewProc("IsDialogMessageW")
	pSetFocus            = user32.NewProc("SetFocus")
	pLoadCursor          = user32.NewProc("LoadCursorW")
)

const (
	inputClass     = "FinComBridgeInput"
	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	wsTabStop      = 0x00010000
	wsCaption      = 0x00C00000
	wsSysMenu      = 0x00080000
	wsExTopmost    = 0x00000008
	wsExDlgFrame   = 0x00000001
	wsExClientEdge = 0x00000200
	esAutoHScroll  = 0x0080
	bsDefPush      = 0x0001
	wmClose        = 0x0010
	wmSetFont      = 0x0030
	emSetSel       = 0x00B1
	emLimitText    = 0x00C5
	inputEditID    = 100
	inputMaxChars  = 100 // 2.2.3 review L3: the edit line takes at most this (the bridge refuses longer with plain words)
)

var (
	inputMu    sync.Mutex // one dialog at a time
	inputOnce  sync.Once
	inputHinst uintptr
	inputEdit  uintptr
	inputText  string
	inputOK    bool
	inputDone  bool
)

func inputProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmCommand:
		switch wp & 0xffff {
		case 1: // OK (or Enter)
			n, _, _ := pGetWindowTextLength.Call(inputEdit)
			buf := make([]uint16, n+1)
			pGetWindowText.Call(inputEdit, uintptr(unsafe.Pointer(&buf[0])), n+1)
			inputText, inputOK = windows.UTF16ToString(buf), true
			pDestroyWindow.Call(hwnd)
		case 2: // Cancel (or Esc)
			pDestroyWindow.Call(hwnd)
		}
		return 0
	case wmClose:
		pDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		inputDone = true
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wp, lp)
	return r
}

// inputBox: the text typed and true on OK; "" and false on Cancel or when closed
func inputBox(title, prompt, def string) (string, bool) {
	inputMu.Lock()
	defer inputMu.Unlock()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	inputOnce.Do(func() {
		inputHinst, _, _ = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
		cur, _, _ := pLoadCursor.Call(0, 32512) // IDC_ARROW
		wc := wndClassEx{cbSize: uint32(unsafe.Sizeof(wndClassEx{})), lpfnWndProc: windows.NewCallback(inputProc), hInstance: inputHinst,
			hCursor: cur, hbrBackground: 16 /* COLOR_BTNFACE+1 */, lpszClassName: u16(inputClass)}
		pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	})
	inputText, inputOK, inputDone = "", false, false
	const w, h = 420, 180
	sx, _, _ := pGetSystemMetrics.Call(0)
	sy, _, _ := pGetSystemMetrics.Call(1)
	hwnd, _, _ := pCreateWindowEx.Call(wsExDlgFrame|wsExTopmost, uintptr(unsafe.Pointer(u16(inputClass))), uintptr(unsafe.Pointer(u16(title))),
		wsCaption|wsSysMenu|wsVisible, (sx-w)/2, (sy-h)/2, w, h, 0, 0, inputHinst, 0)
	if hwnd == 0 {
		return "", false
	}
	font, _, _ := pGetStockObject.Call(17) // DEFAULT_GUI_FONT
	child := func(ex uintptr, class, text string, style, x, y, cw, ch, id uintptr) uintptr {
		c, _, _ := pCreateWindowEx.Call(ex, uintptr(unsafe.Pointer(u16(class))), uintptr(unsafe.Pointer(u16(text))), wsChild|wsVisible|style, x, y, cw, ch, hwnd, id, inputHinst, 0)
		pSendMessage.Call(c, wmSetFont, font, 1)
		return c
	}
	child(0, "STATIC", prompt, 0, 12, 10, w-40, 44, 0)
	inputEdit = child(wsExClientEdge, "EDIT", def, wsTabStop|esAutoHScroll, 12, 58, w-40, 24, inputEditID)
	child(0, "BUTTON", "OK", wsTabStop|bsDefPush, w-198, 96, 80, 28, 1)
	child(0, "BUTTON", "Cancel", wsTabStop, w-110, 96, 80, 28, 2)
	pSendMessage.Call(inputEdit, emLimitText, inputMaxChars, 0)
	pSendMessage.Call(inputEdit, emSetSel, 0, ^uintptr(0))
	pSetForegroundWindow.Call(hwnd)
	pSetFocus.Call(inputEdit)
	var m msgT
	for !inputDone {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		if d, _, _ := pIsDialogMessage.Call(hwnd, uintptr(unsafe.Pointer(&m))); d != 0 {
			continue
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
	return inputText, inputOK
}
