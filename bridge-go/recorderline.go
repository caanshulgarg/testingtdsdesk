// Round 18 (2.1.9): the recorder trial's lines. The trial add-on (FinComRecorderTrial.tdl, loaded in Tally on ZZ TEST)
// writes C:\ProgramData\FinCom\recorder\<company GUID>.txt (or name-<company>.txt) in UTF-16LE, with or without a BOM.
// Each line: "FCR1|" then key=value joined by "|" in a fixed order:
//
//	FCR1|ev=|t0=|tw=|cguid=|cname=|user=|obj=|guid=|mid=|aid=|vtype=|vno=|vdate=|name=|parent=|narr=|t1=
//
// 2.2.0: the live add-on (FinComRecorder.tdl) writes "|src=live" after t1, on the same line, in daily files
// <company GUID>-<yyyymmdd>.txt (recorder_live.go).
//
// narr is free text from "|narr=" to the LAST "|t1=" (it may hold "|"); a physical line that does not start with
// "FCR1|" continues the line before it (a narration over several lines). t0, tw and t1 are seconds ($$MachineTime).
// Read here for the trial's summary; 2.2.0 reads the same lines.
//
// Next (next-userfile): the live add-on writes "|w=<Windows user>" right after tw (the Windows user whose Tally wrote the
// line), in that user's own daily file <company GUID>-<day>-<Windows user>.txt (userfile.go). Optional: older lines have
// none. After tw, so an older bridge reads it as part of tw (a time it needs only when t0 is missing) and the line still
// ends "|t1=...|src=live" as its reader requires.
package main

import (
	"strings"
	"unicode/utf8"
)

type recLine struct {
	Ev, T0, Tw, CGUID, CName, User, Obj, GUID, MID, AID, VType, VNo, VDate, Name, Parent, Narr, T1 string
	W                                                                                              string // next-userfile: the Windows user ("" from an older add-on)
	Src                                                                                            string // 2.2.0: "live" from the live add-on (FinComRecorder.tdl writes "|src=live" after t1); "" from the trial's
	// 2.2.2 (the bridge's own, never on a line): a pair's first half's GUID and AlterID (the AlterID before the save: a
	// lower bound for Tally's; the GUID flagged when it is another entry's)
	PreGUID, PreAID string
}

var recKeys = []string{"ev", "t0", "tw", "cguid", "cname", "user", "obj", "guid", "mid", "aid", "vtype", "vno", "vdate", "name", "parent"}

// a recorder file's bytes as text: UTF-16LE with its BOM, UTF-16LE without one (every other byte 0), else UTF-8
func decodeRecorderText(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		return utf16le(b[2:])
	}
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return string(b[3:])
	}
	if len(b) >= 4 && len(b)%2 == 0 {
		zeros, n := 0, minI(len(b), 400)
		for i := 1; i < n; i += 2 {
			if b[i] == 0 {
				zeros++
			}
		}
		if zeros > n/4 {
			return utf16le(b)
		}
	}
	if !utf8.Valid(b) {
		return fromCP1252(b)
	}
	return string(b)
}

// the logical lines of a recorder file: continuation lines joined to the line before with "\n"
func recorderLogical(text string) []string {
	var out []string
	for _, l := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		l = strings.TrimSuffix(l, "\r")
		if strings.HasPrefix(l, "FCR1|") {
			out = append(out, l)
		} else if len(out) > 0 && l != "" {
			out[len(out)-1] += "\n" + l
		}
	}
	return out
}

// one logical line; false when it is not an FCR1 line. Each value runs to the next key in the fixed order (a value
// holding "|" is kept whole); narr runs to the LAST "|t1="
func parseRecorderLine(l string) (recLine, bool) {
	if !strings.HasPrefix(l, "FCR1|") {
		return recLine{}, false
	}
	rest := l[len("FCR1|"):]
	ni := strings.Index(rest, "|narr=")
	ti := strings.LastIndex(rest, "|t1=")
	if ni < 0 || ti < ni {
		return recLine{}, false
	}
	head, narr, t1 := rest[:ni], rest[ni+len("|narr="):ti], rest[ti+len("|t1="):]
	vals := make([]string, len(recKeys))
	pos, w := 0, ""
	for i, k := range recKeys {
		if k == "cguid" && strings.HasPrefix(head[pos:], "w=") {
			// next-userfile: the Windows user, after tw (its value runs to "|cguid=", as tw's did)
			j := strings.Index(head[pos:], "|cguid=")
			if j < 0 {
				return recLine{}, false
			}
			w, pos = head[pos+len("w="):pos+j], pos+j+1
		}
		if !strings.HasPrefix(head[pos:], k+"=") {
			return recLine{}, false
		}
		pos += len(k) + 1
		end := len(head)
		if i+1 < len(recKeys) {
			next := "|" + recKeys[i+1] + "="
			if k == "tw" && strings.Contains(head[pos:], "|w=") {
				if j, c := strings.Index(head[pos:], "|w="), strings.Index(head[pos:], next); j >= 0 && (c < 0 || j < c) {
					next = "|w="
				}
			}
			j := strings.Index(head[pos:], next)
			if j < 0 {
				return recLine{}, false
			}
			end = pos + j
		}
		vals[i] = head[pos:end]
		pos = end
		if i+1 < len(recKeys) {
			pos++ // the "|"
		}
	}
	src := ""
	if i := strings.LastIndex(t1, "|src="); i >= 0 {
		t1, src = t1[:i], strings.TrimSpace(t1[i+len("|src="):])
	}
	return recLine{Ev: vals[0], T0: vals[1], Tw: vals[2], CGUID: vals[3], CName: vals[4], User: vals[5], Obj: vals[6], GUID: vals[7], MID: vals[8], AID: vals[9],
		VType: vals[10], VNo: vals[11], VDate: vals[12], Name: vals[13], Parent: vals[14], Narr: narr, T1: strings.TrimSpace(t1), Src: src, W: strings.TrimSpace(w)}, true
}

// every FCR1 line of a recorder file's text
func parseRecorderText(text string) []recLine {
	var out []recLine
	for _, l := range recorderLogical(text) {
		if r, ok := parseRecorderLine(l); ok {
			out = append(out, r)
		}
	}
	return out
}
