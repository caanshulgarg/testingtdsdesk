// Posting to Tally: masters first, then entries, each with its own answer; every entry posted is read back by its
// FinCom tag (TDSDesk:<id>) in the narration. As bridge 1.15.0 (Invoke-Import, Read-ImportResult, Remove-TallyVoucher).
package main

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"
)

var reTag = regexp.MustCompile(`TDSDesk:[A-Za-z0-9._-]+`)

// what Tally answered to an import
func readImportResult(text string) M {
	n := func(tag string) int { return toInt(group(`<`+tag+`>\s*(-?\d+)\s*</`+tag+`>`, text, 1)) }
	var errs []string
	for _, m := range re(`<LINEERROR>([\s\S]*?)</LINEERROR>`).FindAllStringSubmatch(text, -1) {
		errs = append(errs, html.UnescapeString(html.UnescapeString(strings.TrimSpace(m[1]))))
	}
	created, altered, errors_, exceptions, ignored := n("CREATED"), n("ALTERED"), n("ERRORS"), n("EXCEPTIONS"), n("IGNORED")
	ok := created+altered > 0 && errors_ == 0 && exceptions == 0
	msg := strings.Join(errs, " ")
	if !ok && msg == "" {
		switch {
		case ignored > 0:
			msg = "Tally ignored it (it may already exist)."
		case exceptions > 0:
			msg = "Tally reported an exception. Check the ledger names and the voucher type."
		default:
			msg = "Tally did not create it."
		}
	}
	return M{"ok": ok, "created": created, "altered": altered, "errors": errors_, "exceptions": exceptions, "ignored": ignored, "message": msg, "lastVchId": group(`<LASTVCHID>\s*(\d+)\s*</LASTVCHID>`, text, 1)}
}

func importEnvelope(report, company, body string) string {
	return "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>" + report + "</REPORTNAME>" +
		"<STATICVARIABLES><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" + body + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
}

func flat(s string) string { return re(`\s+`).ReplaceAllString(s, " ") }

// posting may happen only from the one bridge that posts: never in test mode (beside bridge 1.15.0)
func postingAllowed() error {
	if !cfgB("AllowImport") {
		return errors.New("Posting to Tally is switched off in tds-bridge.config.json (AllowImport).")
	}
	if why := readOnlyWhy(); why != "" {
		return errors.New(why)
	}
	return nil
}

// masters first, then vouchers, one request each so every item gets its own result
func invokeImport(p M) (M, error) {
	if err := postingAllowed(); err != nil {
		return nil, err
	}
	company := str(p["company"])
	if company == "" {
		return nil, errors.New("No company given.")
	}
	port, err := findCompanyPort(company, toInt(p["port"]))
	if err != nil {
		return nil, err
	}
	results := []M{}
	// the job follows each entry as Tally answers it (FinCom shows it live)
	onItem, _ := p["onItem"].(func(M))
	add := func(r M) {
		results = append(results, r)
		if onItem != nil {
			onItem(r)
		}
	}
	var pending []M
	groups := []struct {
		kind, report string
		items        []any
	}{{"master", "All Masters", arr(p["masters"])}, {"voucher", "Vouchers", arr(p["vouchers"])}}
	for _, g := range groups {
		for _, itv := range g.items {
			it := obj(itv)
			if it == nil {
				continue
			}
			x := str(it["xml"])
			id := it["id"]
			// a voucher type may only have its numbering changed: no other field, and only an Alter
			vtOnly := false
			if re(`^\s*<VOUCHERTYPE\b`).MatchString(x) {
				inner := re(`(?s)^\s*<VOUCHERTYPE[^>]*>|</VOUCHERTYPE>\s*$`).ReplaceAllString(x, "")
				tags := re(`<([A-Z.]+)>`).FindAllStringSubmatch(inner, -1)
				other := false
				for _, t := range tags {
					if t[1] != "NAME" && t[1] != "NUMBERINGMETHOD" && t[1] != "PREVENTDUPLICATES" {
						other = true
					}
				}
				vtOnly = strings.Contains(x, `ACTION="Alter"`) && len(tags) > 0 && !other
			}
			// a voucher without a proper date never reaches Tally (Tally answers "Voucher date is missing" but may still make it)
			if re(`^\s*<VOUCHER\b`).MatchString(x) && !re(`<DATE>(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])</DATE>`).MatchString(x) {
				add(M{"id": id, "kind": g.kind, "ok": false, "message": "The entry has no valid date, so it was not sent to Tally."})
				continue
			}
			if !re(`^\s*<(VOUCHER|LEDGER|GROUP)\b`).MatchString(x) && !vtOnly {
				add(M{"id": id, "kind": g.kind, "ok": false, "message": "Only VOUCHER, LEDGER or GROUP objects can be posted, or a voucher type's numbering changed."})
				continue
			}
			raw, err := invokeTally(fin, port, importEnvelope(g.report, company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+x+"</TALLYMESSAGE>"), 0)
			if err != nil {
				add(M{"id": id, "kind": g.kind, "ok": false, "message": "Tally did not answer: " + err.Error()})
				continue
			}
			r := readImportResult(raw)
			f := flat(raw)
			r["replySnip"] = cut(f, 300)
			shown := re(`^.*?(<IMPORTRESULT>|<RESPONSE>)`).ReplaceAllString(f, "$1")
			writeLog("    Tally replied: " + cut(shown, 400))
			r["id"], r["kind"], r["company"], r["port"] = id, g.kind, company, port
			if r["ok"] == true && g.kind == "voucher" {
				r["xmlSent"] = x
				pending = append(pending, r)
			}
			add(r)
			st := "FAILED " + str(r["message"])
			if r["ok"] == true {
				st = "created (not read back)"
			}
			writeLog("  " + g.kind + " " + str(id) + ": " + st)
		}
	}
	// one read-back for everything just posted
	if len(pending) > 0 {
		var dates []string
		for _, r := range pending {
			if d := group(`<DATE>(\d{8})</DATE>`, str(r["xmlSent"]), 1); d != "" {
				dates = append(dates, d)
			}
		}
		dates = uniqSorted(dates)
		var heads []M
		listSeesOptional := false
		from, to := "", ""
		if len(dates) > 0 {
			from, to = dates[0], dates[len(dates)-1]
			for _, try := range []string{"list", "daybook"} {
				var h []M
				var e error
				if try == "list" {
					h, e = voucherHeads(fin, port, company, from, to)
				} else {
					h, e = dayBookHeads(fin, port, company, from, to)
				}
				if e != nil {
					h = nil
				}
				heads = h
				if len(h) > 0 {
					if try == "list" {
						for _, x := range h {
							if strings.EqualFold(str(x["optional"]), "yes") {
								listSeesOptional = true
								break
							}
						}
					}
					break
				}
			}
			writeLog(fmt.Sprintf("  read-back for the batch: %d vouchers listed for %s to %s", len(heads), from, to))
		}
		for _, r := range pending {
			xs := str(r["xmlSent"])
			tag := reTag.FindString(xs)
			var hit M
			if tag != "" {
				for _, h := range heads {
					if strings.Contains(str(h["narration"]), tag) {
						hit = h
						break
					}
				}
			} else if lv := str(r["lastVchId"]); lv != "" {
				// Tally's "last voucher id" can point at an older voucher, so it is trusted only for an entry without a tag
				for _, h := range heads {
					if str(h["masterId"]) == lv {
						hit = h
						break
					}
				}
			}
			switch {
			case hit != nil:
				addPostedForCopy(company, hit, xs)
				r["verified"], r["optional"] = true, strings.EqualFold(str(hit["optional"]), "yes")
				r["vchNumber"], r["vchType"], r["guid"], r["masterId"], r["vchDate"] = str(hit["number"]), str(hit["type"]), str(hit["guid"]), str(hit["masterId"]), str(hit["date"])
			case re(`<ISOPTIONAL>\s*Yes`).MatchString(xs) && !listSeesOptional:
				r["verified"] = nil
				r["verifyNote"] = "posted as an Optional voucher, which this Tally does not list"
				r["message"] = "Tally created this as an Optional voucher, which does not show in the Day Book and cannot be read back here. Look for it in Display More Reports > Exception Reports > Optional Vouchers before posting it again."
			case len(heads) > 0:
				r["verified"], r["ok"] = false, false
				elsewhere := ""
				if tag != "" {
					for _, sx := range openCompanies(false) {
						if toInt(sx["port"]) != port {
							continue
						}
						for _, cx := range sessCompanies(sx) {
							cn := str(cx["name"])
							if cn == "" || sameCompany(cn, company) {
								continue
							}
							if other, e := voucherHeads(fin, port, cn, from, to); e == nil {
								for _, h := range other {
									if strings.Contains(str(h["narration"]), tag) {
										elsewhere = cn
										break
									}
								}
							}
							if elsewhere != "" {
								break
							}
						}
						if elsewhere != "" {
							break
						}
					}
				}
				if elsewhere != "" {
					r["wrongCompany"] = elsewhere
					r["message"] = "Tally put this entry into '" + elsewhere + "', not '" + company + "'. Delete it from '" + elsewhere + "' in Tally, close that company (or make '" + company + "' the active one), then post again."
					writeLog("  WRONG COMPANY: " + tag + " went into '" + elsewhere + "' instead of '" + company + "'")
				} else {
					r["message"] = "Tally replied 'created', but the entry cannot be found in '" + company + "' or in any other company open in this Tally. It was not marked as posted. Tally's reply: " + str(r["replySnip"])
				}
			default:
				r["verified"] = nil
				r["verifyNote"] = "Tally listed no vouchers for those dates"
			}
			delete(r, "xmlSent")
		}
	}
	okN := 0
	for _, r := range results {
		if r["ok"] == true {
			okN++
		}
	}
	writeLog(fmt.Sprintf("Import into '%s': %d of %d created", company, okN, len(results)))
	out := make([]any, len(results))
	for i, r := range results {
		out[i] = r
	}
	return M{"ok": true, "company": company, "port": port, "results": out}, nil
}

// delete one voucher from Tally, trying each way Tally identifies a voucher, and saying what Tally answered
func removeTallyVoucher(port int, company, guid, masterID, vtype, vdate, vnum string) (M, error) {
	var d time.Time
	if isTallyDate(vdate) {
		d = fromTallyDate(vdate)
	}
	type try struct{ name, x string }
	var tries []try
	vt := esc(vtype)
	if guid != "" {
		tries = append(tries, try{"GUID", `<VOUCHER REMOTEID="` + esc(guid) + `" VCHTYPE="` + vt + `" ACTION="Delete"><DATE>` + esc(vdate) + "</DATE><VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME></VOUCHER>"})
	}
	if masterID != "" {
		tries = append(tries, try{"MasterID", `<VOUCHER TAGNAME="MASTERID" TAGVALUE="` + esc(masterID) + `" VCHTYPE="` + vt + `" ACTION="Delete"><VOUCHERTYPENAME>` + vt + "</VOUCHERTYPENAME></VOUCHER>"})
	}
	if vnum != "" && !d.IsZero() {
		for _, ds := range []string{d.Format("2-Jan-2006"), vdate} {
			tries = append(tries, try{"number " + ds, `<VOUCHER DATE="` + esc(ds) + `" TAGNAME="Voucher Number" TAGVALUE="` + esc(vnum) + `" VCHTYPE="` + vt + `" ACTION="Delete"><DATE>` + esc(vdate) + "</DATE><VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME><VOUCHERNUMBER>" + esc(vnum) + "</VOUCHERNUMBER></VOUCHER>"})
		}
	}
	if len(tries) == 0 {
		return M{"ok": false, "message": "This entry has no Tally identity (GUID, master ID or voucher number), so it cannot be removed automatically."}, nil
	}
	var said []string
	for _, t := range tries {
		raw, err := invokeTally(fin, port, importEnvelope("Vouchers", company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+t.x+"</TALLYMESSAGE>"), 0)
		if err != nil {
			return nil, err
		}
		res := readImportResult(raw)
		writeLog("  delete by " + t.name + ": " + cut(flat(raw), 300))
		if dl := group(`<DELETED>\s*(\d+)\s*</DELETED>`, raw, 1); dl != "" && toInt(dl) > 0 {
			return M{"ok": true, "how": t.name, "message": ""}, nil
		}
		if m := str(res["message"]); m != "" && !strings.Contains(m, "did not create") && !contains(said, m) {
			said = append(said, m)
		}
	}
	why := strings.Join(said, " ")
	if why == "" {
		why = "Tally did not delete it (it may already be gone, or its voucher number or type has changed)."
	}
	return M{"ok": false, "message": why}, nil
}

// the FinCom tags of these items already in Tally (found by reading the dates they carry); nil when Tally did not answer
// a read, so nothing is sent again on a guess
func findPostedTags(port int, company string, items []M, ledger string) map[string]M {
	found := map[string]M{}
	var dates []string
	for _, it := range items {
		if d := group(`<DATE>(\d{8})</DATE>`, str(it["xml"]), 1); d != "" {
			dates = append(dates, d)
		}
	}
	dates = uniqSorted(dates)
	if len(dates) == 0 {
		return found
	}
	a, b := dates[0], dates[len(dates)-1]
	var heads []M
	read := false
	if ledger != "" {
		if lv, err := ledgerVoucherList(fin, port, company, ledger, a, b); err == nil && lv != nil {
			heads, read = lv, true
		}
	}
	if !read {
		if h, err := voucherHeads(fin, port, company, a, b); err == nil {
			heads, read = h, true
		}
	}
	if len(heads) == 0 {
		if h, err := dayBookHeads(fin, port, company, a, b); err == nil {
			heads, read = h, true
		}
	}
	if !read {
		return nil
	}
	for _, it := range items {
		tag := reTag.FindString(str(it["xml"]))
		if tag == "" {
			continue
		}
		for _, h := range heads {
			if strings.Contains(str(h["narration"]), tag) {
				found[str(it["id"])] = h
				break
			}
		}
	}
	return found
}

// a failure in words
func tallyTrouble(msg string) string {
	if re(`timed out|timeout|operation has timed`).MatchString(msg) {
		return "Tally is busy and did not answer in time (a report, a pop-up or another user may be holding it)."
	}
	if re(`refused|actively refused|Unable to connect|No connection|could not be made`).MatchString(msg) {
		return "Tally is not answering on its port: is TallyPrime open, with the company loaded?"
	}
	return msg
}
