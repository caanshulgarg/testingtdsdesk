// FinCom Bridge 2.5.5 (the owner's Option B): this Windows login's own Tally port, the same number FinCom's Tally page
// proposes (app/src/lib/connectSteps.js ownPort, through app/src/lib/tallyPort.js freePort): counted from the login's
// name, skipping only the ports other logins use and the ports FinCom never proposes. The page and the bridge must agree
// on it, so this is the page's algorithm ported exactly (loginport255_test.go runs both on made-up names).
//
// Used only where the bridge chooses a port for a tally.ini that only this login uses (iniconnect253.go): the file names
// no port and its connection is being switched on by the bridge's write, on a computer one person uses (a shared
// tally.ini keeps 2.5.4's rule: nothing written). The port is taken only when no other tally.ini names it and nothing
// listens on it; otherwise the 2.5.3 choice stands. A port the file already names is never changed.
package main

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

// tallyPort.js PORT_AVOID: TallyPrime's own default and ports other programs commonly take
var loginPortAvoid = map[int]bool{9000: true, 9001: true, 9009: true, 9030: true, 9042: true, 9043: true, 9050: true, 9051: true, 9060: true,
	9080: true, 9090: true, 9091: true, 9092: true, 9093: true, 9094: true, 9095: true, 9099: true}

// JavaScript's \s and String.prototype.trim's white space (ECMAScript WhiteSpace and LineTerminator)
func jsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// JavaScript's toLowerCase for a name: Go's per-letter lower case, plus the two rules JavaScript adds (İ becomes i with
// a dot above; a final capital sigma becomes ς)
func jsLower(s string) string {
	rs := []rune(s)
	var b strings.Builder
	for i, r := range rs {
		switch {
		case r == 0x130:
			b.WriteString("i̇")
		case r == 0x3A3 && i > 0 && unicode.IsLetter(rs[i-1]) && (i+1 >= len(rs) || !unicode.IsLetter(rs[i+1])):
			b.WriteRune(0x3C2)
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// tallyPort.js lc: trimmed, runs of white space as one space, lower case
func loginPortKey(user string) string {
	f := strings.FieldsFunc(user, jsSpace)
	return jsLower(strings.Join(f, " "))
}

// connectSteps.js short: the part after the last backslash (DOMAIN\user -> user), trimmed
func loginShort(user string) string {
	if i := strings.LastIndex(user, `\`); i >= 0 {
		user = user[i+1:]
	}
	return strings.TrimFunc(user, jsSpace)
}

// tallyPort.js freePort(seen, user): the first of 9000-9099 not in seen and not avoided, counted from a start that
// depends on the user's name (h = h*31 + each UTF-16 code unit's first, mod 9973, as JavaScript's for-of and
// charCodeAt(0) give it); the first candidate when none is at or after the start; 0 when there is none
func loginFreePort(seen map[int]bool, user string) int {
	var cands []int
	for p := 9000; p <= 9099; p++ {
		if !seen[p] && !loginPortAvoid[p] {
			cands = append(cands, p)
		}
	}
	h := 0
	for _, r := range loginPortKey(user) {
		u := int(r)
		if r > 0xFFFF {
			hi, _ := utf16.EncodeRune(r)
			u = int(hi)
		}
		h = (h*31 + u) % 9973
	}
	for _, p := range cands {
		if p >= 9000+h%100 {
			return p
		}
	}
	if len(cands) > 0 {
		return cands[0]
	}
	return 0
}

// this login's own port as the page works it out for a login whose computer no other login uses (connectSteps.js
// ownPort with no other login's ports): 0 when the login's name is not known
func loginOwnPort(windowsUser string) int {
	u := loginShort(windowsUser)
	if u == "" {
		return 0
	}
	return loginFreePort(nil, u)
}
