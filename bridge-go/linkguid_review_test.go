package main

// The owner's hard rule (19-Nov-2026), the review of next-fix-linkedguid: a posting goes only into the Tally company the
// client is linked to, by the company's GUID, never by its name. Made-up companies and a fake Tally only:
//   - a browser's posting (/jobs, /import, /unpost) that names no GUID is never sent, even with a GUID held here for the
//     name: it ends failed ("Update FinCom: ...", each entry not sent) or is refused; Retry with the GUID posts it
//   - a posting handed back for another GUID than the one its progress names (its payload naming none) is refused
//   - a Tally whose owner Windows cannot tell, while Windows tells the owner of another Tally: never posted to
//   - Tally's reply with exceptions (or ignored) and nothing created: needs review, kept on this computer's record
//   - Tally not answering its company list for a few rounds: the port is named in the wait
//   - the beat's open companies: only from the Tallies a posting would use
//   - guidChecked from a caller of /import is not taken

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func lgWaitLong(t *testing.T, id, what string, ok func(p M) bool) M {
	t.Helper()
	dir, _ := jobDir(id)
	for i := 0; i < 600; i++ {
		if p := readProgress(dir); p != nil && ok(p) {
			return p
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("job %s: %s did not come (%v)", id, what, readProgress(dir)["message"])
	return nil
}

// a browser's job naming no GUID: never sent (the GUID held here for the name is not used): failed, each entry not
// sent; Retry with the GUID posts it; another GUID after that is refused
func TestLinkedBrowserJobNoGUID(t *testing.T) {
	_, l := lgSetup(t)
	noteCompanyGUID(zz, lgGUID)
	vs := lgVouchers("b", 2)
	j, err := newPostJob(M{"jobId": "job-lg-browser-noguid", "company": zz, "vouchers": vs})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, str(j["id"]), "the end", func(p M) bool { return str(p["status"]) == "failed" })
	time.Sleep(300 * time.Millisecond)
	if l.n() != 0 || !strings.HasPrefix(str(p["message"]), "Update FinCom: this request does not name the linked Tally company") {
		t.Fatalf("a browser's posting with no GUID: %d imports, %q", l.n(), p["message"])
	}
	if jobAlive("job-lg-browser-noguid") {
		t.Fatal("the posting is still active")
	}
	if _, err := newPostJob(M{"jobId": "job-lg-browser-noguid", "company": zz, "guid": lgGUID, "vouchers": vs}); err != nil {
		t.Fatal(err)
	}
	p = waitJob(t, "job-lg-browser-noguid")
	if str(p["status"]) != "done" || l.n() != 1 || str(p["companyGuid"]) != lgGUID {
		t.Fatalf("Retry with the GUID: %v %q, %d imports", p["status"], p["message"], l.n())
	}
	if _, err := newPostJob(M{"jobId": "job-lg-browser-noguid", "company": zz, "guid": "co-guid-new", "vouchers": vs}); err == nil ||
		!strings.HasPrefix(err.Error(), "The client was linked to another Tally company after this posting was made") {
		t.Fatalf("another GUID: %v", err)
	}
	l.checkSafe(t, lgGUID)
}

// a browser's /import and /unpost naming no GUID: refused, nothing sent, nothing asked of Tally
func TestLinkedBrowserImportUnpostNoGUID(t *testing.T) {
	f, l := lgSetup(t)
	noteCompanyGUID(zz, lgGUID)
	asked := f.n("TDSDeskCompanies")
	if _, err := invokeImport(M{"company": zz, "vouchers": lgVouchers("x", 2)}); err == nil || !strings.HasPrefix(err.Error(), "Update FinCom: this request does not name the linked Tally company") || l.n() != 0 {
		t.Fatalf("/import with no GUID: %v, %d imports", err, l.n())
	}
	code, res := callLocal(t, "POST", "/import", "", `{"company":"`+zz+`","vouchers":[{"id":"x9","xml":"<VOUCHER/>"}]}`)
	if code == 200 || !strings.Contains(str(res["error"]), "Update FinCom") || l.n() != 0 {
		t.Fatalf("/import by HTTP with no GUID: %d %v", code, res)
	}
	code, res = callLocal(t, "POST", "/unpost", "", `{"company":"`+zz+`","vchType":"Journal","vchDate":"20260701","vchNumber":"B-1","masterId":"5"}`)
	if f.n("Import") != 0 || code == 200 && truthy(res["ok"]) || !strings.Contains(str(res["error"]), "Update FinCom") {
		t.Fatalf("/unpost with no GUID: %d %v", code, res)
	}
	if f.n("TDSDeskCompanies") != asked {
		t.Fatalf("Tally asked for a posting that names no GUID: %d", f.n("TDSDeskCompanies")-asked)
	}
}

// guidChecked from a caller of /import is not taken: the company check is asked (and answering no company, nothing is sent)
func TestLinkedImportGuidCheckedNotFromHTTP(t *testing.T) {
	f, l := lgSetup(t)
	lgCheckAnswer(f, l, func() string { return lgNoCompany })
	code, res := callLocal(t, "POST", "/import", "", `{"company":"`+zz+`","guid":"`+lgGUID+`","guidChecked":true,"vouchers":[{"id":"gc1","xml":"`+strings.ReplaceAll(finVoucher("gc1", fgParty, "GC-1", fgDate, "1.00"), `"`, `\"`)+`"}]}`)
	if l.n() != 0 {
		t.Fatalf("sent with guidChecked from HTTP: %d %v", code, res)
	}
	for _, x := range arr(res["results"]) {
		if r := obj(x); r["notSent"] != true {
			t.Fatalf("an entry: %v", r)
		}
	}
}

// a posting handed back for another GUID than the one its progress names (its payload naming none): refused
func TestLinkedHandBackProgressGUID(t *testing.T) {
	for _, keep := range []string{"companyGuid", "windowGuid"} {
		t.Run(keep, func(t *testing.T) {
			_, l := lgSetup(t)
			id := "job-lg-hb-" + keep
			if _, err := newPostJob(M{"jobId": id, "company": zz, "guid": lgGUID, "vouchers": lgVouchers("p", 2)}); err != nil {
				t.Fatal(err)
			}
			waitJob(t, id)
			dir, _ := jobDir(id)
			pay := readObjFileBak(filepath.Join(dir, "payload.json"))
			delete(pay, "guid")
			_ = saveJSONBak(filepath.Join(dir, "payload.json"), pay)
			p := readProgress(dir)
			for _, k := range []string{"companyGuid", "windowGuid"} {
				if k != keep {
					delete(p, k)
				}
			}
			if normGUID(str(p[keep])) != lgGUID {
				t.Fatalf("the progress has no %s: %v", keep, p[keep])
			}
			_ = writeProgress(dir, p)
			if _, err := newPostJob(M{"jobId": id, "company": zz, "guid": "co-guid-new", "fromCloud": true, "vouchers": lgVouchers("p", 2)}); err == nil ||
				!strings.HasPrefix(err.Error(), "The client was linked to another Tally company after this posting was made") {
				t.Fatalf("handed back for another GUID (%s only): %v", keep, err)
			}
			if g := str(readObjFileBak(filepath.Join(dir, "payload.json"))["guid"]); g != "" || l.n() != 1 {
				t.Fatalf("the payload took %q, %d imports", g, l.n())
			}
		})
	}
}

// a Tally whose owner Windows cannot tell, while Windows tells the owner of another one: never posted to
func TestLinkedOwnerUnknownRefused(t *testing.T) {
	s := func(port int, mine any, extra M, cs ...coPair) M {
		var l []any
		for _, c := range cs {
			l = append(l, M{"name": c.name, "guid": c.guid})
		}
		e := M{"port": port, "ok": true, "companies": l, "mine": mine}
		for k, v := range extra {
			e[k] = v
		}
		return e
	}
	cases := []struct {
		name     string
		sess     []M
		kind     string
		wantPort int
	}{
		{"another user's listed, an owner-unknown one has it: waits", []M{s(9000, false, M{"skipped": true}), s(9001, nil, nil, coPair{"A Co", "g1"})}, "notopen", 0},
		{"another user's not skipped, an owner-unknown one has it: waits", []M{s(9000, false, nil, coPair{"B Co", "g2"}), s(9001, nil, nil, coPair{"A Co", "g1"})}, "notopen", 0},
		{"no owner told for any: the owner-unknown one", []M{s(9001, nil, nil, coPair{"A Co", "g1"})}, "", 9001},
	}
	for _, c := range cases {
		h, err := linkedIn(c.sess, "g1", "A Co")
		var lw *linkWait
		switch {
		case c.kind == "" && (err != nil || h.port != c.wantPort):
			t.Errorf("%s: %v %v", c.name, h, err)
		case c.kind != "" && (err == nil || !errorsAs(err, &lw) || lw.kind != c.kind):
			t.Errorf("%s: want a wait %s, got %v %v", c.name, c.kind, h, err)
		}
	}
}

// Tally's reply: nothing created, an exception (or ignored): needs review and on this computer's record (never sent
// again); nothing created, altered or excepted and errors: failed in Tally's words, not on the record
func TestNothingCreatedExceptionsNeedReview(t *testing.T) {
	for _, c := range []struct{ name, counts string }{{"exceptions", "<EXCEPTIONS>1</EXCEPTIONS><IGNORED>0</IGNORED>"}, {"ignored", "<EXCEPTIONS>0</EXCEPTIONS><IGNORED>1</IGNORED>"}} {
		t.Run(c.name, func(t *testing.T) {
			f := newStandTally(t)
			f.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS>" + c.counts + "</IMPORTRESULT></DATA></BODY></ENVELOPE>")
			standBridge(t, f, "")
			id := "ne-" + c.name
			x := finVoucher(id, fgParty, "NE-"+c.name, today(), "1.00")
			r := postOne(t, id, x)
			if r["needsReview"] != true || r["accepted"] != true || r["refusedByTally"] == true {
				t.Fatalf("%s and nothing created: %v", c.name, r)
			}
			if acceptedInfo(acceptedKey(id, x)) == nil {
				t.Fatal("not kept on this computer's record (it could be sent again)")
			}
		})
	}
}

// Tally not giving its company list for a few rounds: the wait names the port (nothing sent meanwhile)
func TestLinkedStalePortNamed(t *testing.T) {
	_, l := lgSetup(t)
	was := postListFn
	postListFn = func() []M { return []M{{"port": 9123, "ok": false, "mine": true, "error": "Tally timed out"}} }
	t.Cleanup(func() { postListFn = was })
	j, err := newPostJob(M{"jobId": "job-lg-stale-port", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("t", 2)})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitLong(t, str(j["id"]), "the port named", func(p M) bool { return strings.Contains(str(p["message"]), "port 9123") })
	if l.n() != 0 || !strings.HasPrefix(str(p["message"]), "Open ZZ TEST in Tally to post") {
		t.Fatalf("%d imports, %q", l.n(), p["message"])
	}
	cancelJob(str(j["id"]), "test")
}

// the beat's open companies: only from the Tallies a posting would use (this user's own while one runs)
func TestBeatLiveOwnTallyOnly(t *testing.T) {
	bridgeFor(t, &standIn{}, "")
	sess := []M{
		{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
		{"port": 9001, "ok": true, "companies": []any{M{"name": "A Co", "guid": "g9"}}},
	}
	var gs []string
	for _, x := range beatCompanies(sess, []any{"A Co"}) {
		if o := obj(x); str(o["name"]) == "A Co" {
			gs = append(gs, str(o["guid"]))
		}
	}
	if strings.Join(gs, ",") != "g1" {
		t.Fatalf("the beat names a GUID of a Tally a posting would not use: %v", gs)
	}
}
