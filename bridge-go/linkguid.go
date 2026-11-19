package main

// The owner's hard rule (19-Nov-2026): FinCom Bridge posts an entry only into the Tally company the client is linked
// to, known by the company's GUID; never into another company. The posting carries the linked GUID (FinCom's queue:
// tally_post_jobs.company_guid, migration 203; a browser's /jobs or /import: its guid, else the GUID this computer holds
// for the name). Before every request to Tally that posts or deletes, the company list is asked afresh (the same
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

// the GUID a posting is for: the one FinCom's queue (or the browser) named, else, for a posting a browser handed
// here without one, the GUID this computer holds for the name; "" when none is known (nothing is posted)
func linkedGuidOf(pl M) string {
	if g := normGUID(str(pl["guid"])); g != "" {
		return g
	}
	// FinCom's queue names it (migration 203); a FinCom before 203 names none (its hand-out gate, the applied 202, gives
	// it only while this bridge reports the link's GUID open): the GUID this computer holds for the name, matched in
	// Tally's list as any (linkedIn: one company of that name, that GUID); none held: it waits
	return normGUID(heldGUID(str(pl["company"])))
}

// where the GUID a posting is for came from: "fincom" (named by FinCom's queue or the browser), "computer" (held here
// for the name), "" (none)
func guidFromOf(pl M, guid string) string {
	switch {
	case normGUID(str(pl["guid"])) != "":
		return "fincom"
	case guid != "":
		return "computer"
	}
	return ""
}

func openToPost(company string) string { return "Open " + company + " in Tally to post" }

// (the staging incident of 19-Nov-2026) whose Tally a posting may go to: this Windows user's own only. A Tally whose owner
// Windows cannot tell (mine unknown) only while no Tally of this user runs at all (on a shared server it may be another
// user's, with the same company open), and then only with the GUID matching (linkedIn matches by GUID alone). Another
// user's (mine false): never
func ownTallyRuns(sessions []M) bool {
	for _, s := range sessions {
		if s["mine"] == true && s["skipped"] != true {
			return true
		}
	}
	return false
}

func tallyToPost(s M, own bool) bool {
	switch s["mine"] {
	case true:
		return true
	case false:
		return false
	}
	return !own
}

// the company check before a posting gave no company, or the company with no GUID: never sent (fail closed), the
// posting waits with Tally's own words when it said any
func checkWait(asked, said string) *linkWait {
	t := openToPost(asked)
	if said = strings.TrimSpace(said); said != "" {
		t += " (Tally said: " + cut(said, 160) + ")"
	}
	return &linkWait{"nocheck", t}
}

// a reason not to post now (a wait, never a failure)
type linkWait struct {
	kind string // noguid, notopen, stale, many, samename
	text string
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
		return linkLook{}, &linkWait{"noguid", openToPost(asked) + ": FinCom does not know yet which Tally company this is (the link has no Tally GUID); it posts by itself once FinCom has seen the company open"}
	}
	var hits []linkLook
	stale := false
	var fresh []M
	own := ownTallyRuns(sessions)
	for _, s := range sessions {
		if s["skipped"] == true || !tallyToPost(s, own) {
			continue
		}
		if s["ok"] != true {
			if re(`(?i)timed out|timeout|busy|` + earlierWords).MatchString(str(s["error"])) {
				stale = true
			}
			continue
		}
		if s["busy"] == true || s["late"] == true || s["kept"] == true {
			stale = true // not Tally's answer now: nothing is known of what it has open
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
		return linkLook{}, &linkWait{"stale", openToPost(asked) + ": Tally did not give its company list just now; asked again by itself"}
	case len(hits) == 0:
		return linkLook{}, &linkWait{"notopen", openToPost(asked)}
	case len(hits) > 1:
		var p []string
		for _, h := range hits {
			p = append(p, fmt.Sprint(h.port))
		}
		return linkLook{}, &linkWait{"many", openToPost(asked) + ": the company is open more than once in Tally (ports " + strings.Join(p, ", ") + "); close it in all but one"}
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
		return linkLook{}, &linkWait{"samename", openToPost(asked) + ": two open companies in Tally are named " + h.name + "; close the one that is not the client's"}
	}
	return h, nil
}

// a posting handed here without a GUID, with none held for the name yet: the list just asked holds the first GUID Tally
// gives for it (noteCompanyGUID, as before this rule); still only one company of that name may be open (linkedIn)
func guidAfterList(guid string, pl M) string {
	if guid != "" {
		return guid
	}
	return normGUID(heldGUID(str(pl["company"])))
}

// the look itself (one company-list request per own Tally, as the posting always asked before each part); the GUID
// it was for
func findLinkedNow(pl M) (linkLook, string, error) {
	sess := postListFn()
	guid := guidAfterList(linkedGuidOf(pl), pl)
	h, err := linkedIn(sess, guid, str(pl["company"]))
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
	for _, s := range sessions {
		if s["skipped"] == true || !tallyToPost(s, ownTallyRuns(sessions)) || s["ok"] != true || toInt(s["port"]) != sent.port {
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
