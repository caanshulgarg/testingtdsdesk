package main

// The owner's hard rule (19-Nov-2026): FinCom Bridge posts an entry only into the Tally company the client is linked
// to, known by the company's GUID; never into another company. The posting carries the linked GUID (FinCom's queue:
// tally_post_jobs.company_guid, migration 203; a browser's /jobs, /import or /unpost: the link's company_guid; one that
// names none is never sent, never matched by the name). Before every request to Tally that posts or deletes, the company list is asked afresh (the same
// request the posting asked before each part anyway: no new request, never a list held from before, never a late
// answer) and the request goes only when exactly one open company of this user's Tally has the linked GUID and no
// other open company has its name; it goes under that company's name as Tally gives it now. The next look (before the
// next part, or the one after the last part) confirms the part before it: the GUID gone or its name changed meanwhile,
// that part is unconfirmed (sent, outcome not known, never sent again; Check Tally settles it). Any doubt: nothing is
// sent, the posting waits ("Open <company> in Tally to post") and tries again by itself.

import (
	"fmt"
	"strings"
)

// the company list for a posting: always Tally's own answer now (no late answer, no list held from before)
var postListTC = &TC{noLate: true, forPost: true}

// test seam: the company list asked for a posting
var postListFn = func() []M { return openCompaniesWith(postListTC, true) }

func normGUID(g string) string { return strings.ToLower(strings.TrimSpace(g)) }

// the GUID a posting is for: the one FinCom's queue or the browser named (the link's company_guid); "" when it names
// none: nothing is posted, never a GUID guessed by the name (held on this computer) or the first one Tally lists
func linkedGuidOf(pl M) string { return normGUID(str(pl["guid"])) }

// where the GUID a posting is for came from: "fincom" (named by FinCom's queue or the browser), "" (none)
func guidFromOf(pl M, guid string) string {
	if guid != "" && normGUID(str(pl["guid"])) == guid {
		return "fincom"
	}
	return ""
}

func openToPost(company string) string { return "Open " + company + " in Tally to post" }

// a posting handed out again for another GUID than the one it was started for or posted into
const linkedElsewhere = "The client was linked to another Tally company after this posting was made: check the entries and post again"

// a posting from FinCom's queue that names no GUID (the coordinator's decision of 19-Nov-2026: the deploy order is 203,
// tally-ingest, the bridge, so FinCom always names it): it waits, nothing is sent, nothing is guessed by name
const noFinComGUID = "Waiting for FinCom to name the linked company"

// a browser's posting (/jobs, /import, /unpost) that names no GUID (a FinCom page from before the rule): never sent; a
// job ends failed at once, each entry not sent (Retry, or the page reloaded and posted again, is safe)
const noBrowserGUID = "Update FinCom: this request does not name the linked Tally company, so nothing was sent to Tally. Reload FinCom, then post or remove it again"

// the wait for a posting that names no GUID
func noGUIDWait(fromCloud bool) *linkWait {
	if fromCloud {
		return &linkWait{kind: "noguid", text: noFinComGUID}
	}
	return &linkWait{kind: "noguid", text: noBrowserGUID}
}

// (the staging incident of 19-Nov-2026) whose Tally a posting may go to: this Windows user's own only. A Tally whose owner
// Windows cannot tell (mine unknown) only while Windows tells the owner of no Tally in the list at all (neither this
// user's nor another's: on a shared server it may be another user's, with the same company open), and then only with the
// GUID matching (linkedIn matches by GUID alone). Another user's (mine false): never. blind: ownersUntold(sessions)
func ownersUntold(sessions []M) bool {
	for _, s := range sessions {
		if _, told := s["mine"].(bool); told {
			return false
		}
	}
	return true
}

func tallyToPost(s M, blind bool) bool {
	switch s["mine"] {
	case true:
		return true
	case false:
		return false
	}
	return blind
}

// the company check before a posting gave no company, or the company with no GUID: never sent (fail closed), the
// posting waits with Tally's own words when it said any
func checkWait(asked, said string) *linkWait {
	t := openToPost(asked)
	if said = strings.TrimSpace(said); said != "" {
		t += " (Tally said: " + cut(said, 160) + ")"
	}
	return &linkWait{kind: "nocheck", text: t}
}

// a reason not to post now (a wait, never a failure)
type linkWait struct {
	kind  string // noguid, notopen, stale, many, samename
	text  string
	ports []string // stale: the ports of the Tallies that did not give their list
}

// a few stale rounds running: the wait names the Tally that does not answer (still nothing is sent)
func staleWords(asked string, lw *linkWait) string {
	return openToPost(asked) + ": Tally on port " + strings.Join(lw.ports, ", ") + " has not given its company list for a while (it may be stuck on a message or a long task); nothing is sent until it answers"
}

func (e *linkWait) Error() string { return e.text }

// where the linked company is open now
type linkLook struct {
	port int
	name string
}

// the target among sessions just asked; asked: the company's name as FinCom has it (for the words)
func linkedIn(sessions []M, guid, asked string) (linkLook, error) {
	guid = normGUID(guid)
	if guid == "" {
		return linkLook{}, &linkWait{kind: "noguid", text: openToPost(asked) + ": FinCom does not know yet which Tally company this is (the link has no Tally GUID); it posts by itself once FinCom has seen the company open"}
	}
	var hits []linkLook
	stale := false
	var fresh []M
	var hung []string
	blind := ownersUntold(sessions)
	for _, s := range sessions {
		if s["skipped"] == true || !tallyToPost(s, blind) {
			continue
		}
		if s["ok"] != true {
			if re(`(?i)timed out|timeout|busy|` + earlierWords).MatchString(str(s["error"])) {
				stale = true
				hung = append(hung, fmt.Sprint(toInt(s["port"])))
			}
			continue
		}
		if s["busy"] == true || s["late"] == true || s["kept"] == true {
			stale = true // not Tally's answer now: nothing is known of what it has open
			hung = append(hung, fmt.Sprint(toInt(s["port"])))
			continue
		}
		fresh = append(fresh, s)
		for _, c := range sessCompanies(s) {
			if normGUID(str(c["guid"])) == guid {
				hits = append(hits, linkLook{toInt(s["port"]), str(c["name"])})
			}
		}
	}
	switch {
	case stale:
		return linkLook{}, &linkWait{"stale", openToPost(asked) + ": Tally did not give its company list just now; asked again by itself", hung}
	case len(hits) == 0:
		return linkLook{}, &linkWait{kind: "notopen", text: openToPost(asked) + elsewhereWords(sessions, guid, blind)}
	case len(hits) > 1:
		var p []string
		for _, h := range hits {
			p = append(p, fmt.Sprint(h.port))
		}
		return linkLook{}, &linkWait{kind: "many", text: openToPost(asked) + ": the company is open more than once in Tally (ports " + strings.Join(p, ", ") + "); close it in all but one"}
	}
	h := hits[0]
	same := 0
	for _, s := range fresh {
		for _, c := range sessCompanies(s) {
			if companyKey(str(c["name"])) == companyKey(h.name) {
				same++
			}
		}
	}
	if same > 1 {
		return linkLook{}, &linkWait{kind: "samename", text: openToPost(asked) + ": two open companies in Tally are named " + h.name + "; close the one that is not the client's"}
	}
	return h, nil
}

// the linked GUID not open in a Tally a posting may use, but listed by one it may not: where, and what to do ("" when
// no other Tally lists it). Owner not told (while Windows tells another's): perhaps run as administrator; another Windows
// user's: open it in this user's own Tally
func elsewhereWords(sessions []M, guid string, blind bool) string {
	var untold, other []string
	for _, s := range sessions {
		if tallyToPost(s, blind) || s["ok"] != true || s["skipped"] == true {
			continue // (only a Tally that answered its list now)
		}
		for _, c := range sessCompanies(s) {
			if normGUID(str(c["guid"])) == guid {
				if s["mine"] == false {
					other = append(other, fmt.Sprint(toInt(s["port"])))
				} else {
					untold = append(untold, fmt.Sprint(toInt(s["port"])))
				}
				break
			}
		}
	}
	switch {
	case len(untold) > 0:
		return ": Tally on port " + strings.Join(untold, ", ") + " has it open, but Windows cannot tell whose Tally that is (it may be running as administrator), so nothing is sent to it; run Tally normally as your own Windows user"
	case len(other) > 0:
		return ": it is open only in another Windows user's Tally (port " + strings.Join(other, ", ") + "); open it in your own Tally"
	}
	return ""
}

// the look itself (one company-list request per own Tally, as the posting always asked before each part); the GUID
// it was for. A posting that names no GUID: nothing asked of Tally, never sent (noBrowserGUID)
func findLinkedNow(pl M) (linkLook, string, error) {
	guid := linkedGuidOf(pl)
	if guid == "" {
		return linkLook{}, "", noGUIDWait(truthy(pl["fromCloud"]))
	}
	h, err := linkedIn(postListFn(), guid, str(pl["company"]))
	return h, guid, err
}

// after a part was sent under name to port: does Tally's list now still show that company there under that name?
// wrong: the name is now another company's (the part may have gone into it: reported to FinCom as wrongCompany)
func confirmLinked(sessions []M, guid string, sent linkLook) (ok bool, wrong string, why string) {
	h, err := linkedIn(sessions, guid, sent.name)
	if err == nil && h.port == sent.port && h.name == sent.name {
		return true, "", ""
	}
	// whatever is now open under the name the part went to, with another GUID
	blind := ownersUntold(sessions)
	for _, s := range sessions {
		if s["skipped"] == true || !tallyToPost(s, blind) || s["ok"] != true || toInt(s["port"]) != sent.port {
			continue
		}
		for _, c := range sessCompanies(s) {
			if companyKey(str(c["name"])) == companyKey(sent.name) && normGUID(str(c["guid"])) != normGUID(guid) {
				wrong = str(c["name"]) + " (Tally GUID " + str(c["guid"]) + ")"
			}
		}
	}
	switch {
	case err != nil:
		why = err.Error()
	case h.name != sent.name:
		why = "the company's name in Tally changed from " + sent.name + " to " + h.name + " right after it was sent"
	default:
		why = "the company moved to another Tally right after it was sent"
	}
	return false, wrong, why
}

// a part's results made unconfirmed: sent (on this computer's record, never sent again), outcome not known
const unconfirmedLine = "Sent to Tally, but the company could not be confirmed right after (%s); not sent again by this bridge. Check Tally in FinCom settles whether it is there"

func unconfirmResults(res []M, why, wrong string) []M {
	out := make([]M, 0, len(res))
	for _, r := range res {
		c := M{}
		for k, v := range r {
			c[k] = v
		}
		if c["refused"] == true || c["notSent"] == true {
			out = append(out, c)
			continue
		}
		c["ok"], c["outcomeUnknown"], c["sent"], c["state"], c["unconfirmed"] = false, true, true, "unknown", true
		delete(c, "verified")
		delete(c, "byReply")
		c["message"] = fmt.Sprintf(unconfirmedLine, why)
		if wrong != "" {
			c["wrongCompany"] = cut(wrong, 200)
		}
		out = append(out, c)
	}
	return out
}
