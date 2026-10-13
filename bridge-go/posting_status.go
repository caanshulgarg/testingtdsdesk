// Posting in plain words, and the rules that keep it safe, kept apart from Tally and Windows so the tests can read them:
//   - the one status line for a posting, the same in the job, /status, the tray and FinCom: "Waiting for Tally: ...",
//     "Sending 2 of 5 to Tally", "Posted 5 of 5 (verified in Tally)", "Failed: ... - ..., then press Retry in FinCom";
//   - each entry's state: waiting, sending, posted (Tally's reply, round 15), needs_review, unknown, in_tally, failed;
//   - the company: exactly the one the posting names (spaces, line breaks and capitals aside), never "whichever is open";
//   - Tally's ports: never 0 in anything saved (0 means "find it"), found again on every try.
package main

import (
	"errors"
	"fmt"
	"strings"
)

// --- the company
func companyKey(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }
func sameCompany(a, b string) bool {
	return a != "" && companyKey(a) == companyKey(b)
}

// the company in Tally that is the one asked for: its name as Tally writes it, and how many open companies match
// (more than one: ambiguous, nothing is chosen). Another open company is never taken instead.
func matchCompany(want string, open []string) (string, int) {
	name, n := "", 0
	seen := map[string]bool{}
	for _, o := range open {
		if sameCompany(want, o) && !seen[o] {
			seen[o] = true
			if name == "" {
				name = o
			}
			n++
		}
	}
	return name, n
}

// --- why a posting waits for Tally (never a reason to fail it)
type tallyWait struct {
	kind string // "closed" (TallyPrime not running or not accepting connections), "busy", "notopen", "many"
	text string
}

func (e *tallyWait) Error() string { return e.text }

// the kind of wait for any error on the way to Tally
func waitKind(err error) string {
	var tw *tallyWait
	if errors.As(err, &tw) {
		return tw.kind
	}
	m := err.Error()
	switch {
	case re(`(?i)timed out|timeout|is busy|did not answer`).MatchString(m):
		return "busy"
	case re(`(?i)refused|Unable to connect|No connection|could not be made|not running|not answering`).MatchString(m):
		return "closed"
	case re(`(?i)is not open`).MatchString(m):
		return "notopen"
	case re(`(?i)more than one Tally`).MatchString(m):
		return "many"
	}
	return "other"
}

// "Waiting for Tally: <plain reason> - <what to do>"
func waitingLine(company string, err error) string {
	const auto = "; it will be posted automatically"
	switch waitKind(err) {
	case "closed":
		return "Waiting for Tally: TallyPrime is not open — open TallyPrime with " + company + auto
	case "busy":
		return "Waiting for Tally: Tally is busy (a report, a pop-up or another user may be holding it) — finish or close it in TallyPrime" + auto
	case "notopen":
		return "Waiting for Tally: " + company + " is not open — open it in TallyPrime" + auto
	case "many":
		return "Waiting for Tally: " + company + " is open in more than one Tally — close it in all but one, or choose your Tally in FinCom > Settings > Tally Bridge" + auto
	}
	return "Waiting for Tally: " + strings.TrimRight(err.Error(), ". ") + auto
}

func sendingLine(n, total int) string {
	if n < 1 {
		n = 1
	}
	if n > total {
		n = total
	}
	return fmt.Sprintf("Sending %d of %d to Tally", n, total)
}

// all sent: "Posted 5 of 5 (Tally's reply)"; round 15 (03-Oct-2026): nothing is read back, so the line names Tally's
// reply; with entries that need review: "Posted 3 of 5; 2 need review" (the job is done, neither posted nor failed);
// the entries sent without an answer (unknown) named when there are any
func postedLine(ok, total, review, unknown int) string {
	l := fmt.Sprintf("Posted %d of %d (Tally's reply)", ok, total)
	if review > 0 {
		l = fmt.Sprintf("Posted %d of %d; %d need review", ok, total, review)
	}
	if unknown > 0 {
		l += fmt.Sprintf("; %d sent with no answer from Tally — Check Tally in FinCom", unknown)
	}
	return l
}

// Tally's refusal of one entry, in plain words: "Failed: ledger 'X' is not in Tally — create it, then press Retry in FinCom"
func failedLine(tallySaid string) string {
	m := strings.TrimSpace(tallySaid)
	const retry = ", then press Retry in FinCom"
	// 2.1.4: the duplicate check before posting said so itself; round 15: this computer's record, and Tally's reply in
	// its own words (needs review), go as they are
	if strings.HasPrefix(m, "Already in Tally (") || m == dupCheckFailedMsg || strings.HasPrefix(m, "This computer posts only to ") ||
		strings.HasPrefix(m, "already sent from this computer on ") || strings.HasPrefix(m, "Tally's reply: ") || m == unknownLine {
		return m
	}
	if g := group(`(?i)ledger\s*'([^']+)'\s*does\s*not\s*exist`, m, 1); g != "" {
		return "Failed: ledger '" + g + "' is not in Tally — create it" + retry
	}
	if g := group(`(?i)voucher\s*type\s*'([^']+)'\s*does\s*not\s*exist`, m, 1); g != "" {
		return "Failed: voucher type '" + g + "' is not in Tally — create it" + retry
	}
	if g := group(`(?i)(?:group|stock item|cost centre|godown|unit)\s*'([^']+)'\s*does\s*not\s*exist`, m, 0); g != "" {
		return "Failed: " + strings.Replace(g, "does not exist", "is not in Tally", 1) + " — create it" + retry
	}
	switch {
	case re(`(?i)no valid date|date is missing|out of (the )?period|outside|before the books|beginning of books|not within`).MatchString(m):
		return "Failed: the entry's date is not within the company's books in Tally — correct the date" + retry
	case re(`(?i)cannot be found in|put this entry into`).MatchString(m):
		return "Failed: " + strings.TrimRight(m, ". ")
	case re(`(?i)not known whether`).MatchString(m):
		return "Failed: not known whether Tally got it — look for it in Tally before posting it again"
	case m == "":
		return "Failed: Tally did not create it — check the entry" + retry
	}
	return "Failed: Tally refused it (" + strings.TrimRight(m, ". ") + ") — correct it" + retry
}

// a job that ended with refused entries: the first reason, and how many
func jobFailedLine(failed, total int, first string) string {
	l := failedLine(first)
	if failed > 1 {
		l = fmt.Sprintf("Failed: %d of %d entries refused by Tally; first: %s", failed, total, strings.TrimPrefix(l, "Failed: "))
	}
	return l
}

// --- each entry's state, from its result (nil: not finished yet)
func itemState(r M, sending bool) string {
	switch {
	case r == nil && sending:
		return "sending"
	case r == nil:
		return "waiting"
	case r["outcomeUnknown"] == true:
		return "unknown" // sent when Tally stopped answering; recorded as sent, settled by Check Tally or the comparison
	case r["needsReview"] == true:
		return "needs_review" // round 15: Tally's reply did not match the request; Tally's words in the reason
	case r["ok"] != true:
		return "failed"
	case r["verified"] == true:
		return "in_tally"
	case r["byReply"] == true:
		return "posted" // round 15: posted by Tally's reply (nothing read back)
	}
	return "sent"
}

// posted (Tally's reply, or confirmed in Tally before), accepted by Tally (a reply that needs review but made some), or
// sent without an answer: never sent again, on any retry, resume or restart (round 15: "sent" is the record)
func confirmedResult(r M) bool {
	return r != nil && (r["ok"] == true || r["accepted"] == true || r["held"] == true || r["sent"] == true)
}

// what is left to send: every item without a result (an entry that failed is not sent again within the same job; Retry
// in FinCom starts it again, where whatever reached Tally is found by its tag first)
func itemsToSend(all []M, results []M) []M {
	had := map[string]bool{}
	for _, r := range results {
		// round 15: an entry sent to Tally (an answer or not) is finished within the job: never sent again. Older notes:
		// one Tally accepted or held is never sent again either
		if r["outcomeUnknown"] != true || r["accepted"] == true || r["held"] == true || r["sent"] == true {
			had[str(r["id"])] = true
		}
	}
	var o []M
	for _, it := range all {
		if !had[str(it["id"])] {
			o = append(o, it)
		}
	}
	return o
}

// --- Tally's ports: a list of real ports, or "auto" (found on every try); never 0
func cleanPorts(v any) ([]int, bool) {
	if _, isStr := v.(string); v == nil || isStr {
		return nil, true
	}
	var o []int
	seen := map[int]bool{}
	for _, x := range arr(v) {
		if p := toInt(x); p > 0 && p < 65536 && !seen[p] {
			seen[p] = true
			o = append(o, p)
		}
	}
	return o, len(o) == 0
}

// the settings never keep a port 0: the bridge's own port goes back to its default, Tally's ports to "auto"
func guardPorts(c *Ordered) {
	if c.Has("Port") {
		if p := toInt(c.Get("Port")); p <= 0 || p > 65535 {
			def := 9100
			if strings.EqualFold(str(c.Get("Mode")), "test") {
				def = 9101
			}
			c.Set("Port", float64(def))
		}
	}
	if c.Has("TallyPorts") {
		v := c.Get("TallyPorts")
		if _, isStr := v.(string); !isStr && v != nil {
			ports, auto := cleanPorts(v)
			if auto {
				c.Set("TallyPorts", "auto")
			} else {
				a := make([]any, len(ports))
				for i, p := range ports {
					a[i] = float64(p)
				}
				c.Set("TallyPorts", a)
			}
		}
	}
	if c.Has("FallbackPorts") {
		ports, _ := cleanPorts(c.Get("FallbackPorts"))
		if len(ports) == 0 {
			ports = []int{9000, 9001, 9002, 9003, 9004, 9005}
		}
		a := make([]any, len(ports))
		for i, p := range ports {
			a[i] = float64(p)
		}
		c.Set("FallbackPorts", a)
	}
}
