package main

// FinCom Bridge 2.5.19: the allow-list's table as 2.5.18 had it, rebuilt from today's builders (the history tests of
// earlier versions start from it): the seven requests 2.5.19 added left out, the four rows whose FETCH grew (C5, C7) with
// 2.5.18's FETCH and words. Nothing else differs: TestR2519TableOtherwise2518 holds it to 2.5.18's hash.

import (
	"regexp"
	"strings"
	"testing"
)

// a FinComVoucherBatch request as 2.5.18 built it: C5's ISPOSTDATED out of the end of its FETCH (only there)
func batch2518(x string) string {
	return strings.Replace(x, ", ISPOSTDATED</FETCH>", "</FETCH>", 1)
}

// a stripped entry as an answer to 2.5.18's group request gives it: the captures of FinComVoucherBatch were taken before
// C5 asked ISPOSTDATED, so the entry request's answer (which Tally sends whole) is compared without it when the group's
// capture has none
var rePostDated = regexp.MustCompile(`<ISPOSTDATED>[^<]*</ISPOSTDATED>`)

func objectAs2518(batchCapture, obj string) string {
	if strings.Contains(batchCapture, "<ISPOSTDATED") {
		return obj
	}
	return rePostDated.ReplaceAllString(obj, "")
}

var added2519 = []string{dayPartID, billOpenID, vchTypesID, costCentresID, costCatsID, gstRegsID, groupClosingID}

func allowListRows2518() string {
	samples := allowListSamples()
	for _, id := range []string{ledListID, ledChangesID, ledByNameID} {
		samples[id] = strings.Replace(samples[id], "<FETCH>"+ledFetchNow()+"</FETCH>", "<FETCH>"+ledFetch244+"</FETCH>", 1)
	}
	samples[vchBatchID] = strings.Replace(samples[vchBatchID], ", ISPOSTDATED</FETCH>", "</FETCH>", 1)
	list := map[string]allowedReq{}
	for k, v := range allowListNow() {
		list[k] = v
	}
	for _, id := range added2519 {
		delete(list, id)
	}
	for _, id := range []string{fixVoucherID, fixLedgerID} { // fix in place (fixalter.go): added after 2.5.19
		delete(list, id)
	}
	for id, add := range allowChanged2519 {
		a := list[id]
		a.purpose = strings.TrimSuffix(a.purpose, add)
		list[id] = a
	}
	st := list[stockID] // the stock row's version word (2.5.19 named itself there; 2.5.20 does now)
	st.purpose = strings.Replace(st.purpose, "unchanged in 2.5.20)", "unchanged in 2.5.18)", 1)
	list[stockID] = st
	return allowListRowsOf(samples, list)
}

// 2.5.18's table hash (docs/tally-allowlist.md at a7174e47e): every row but the 2.5.19 ones exactly as it was
func TestR2519TableOtherwise2518(t *testing.T) {
	if h := allowListHash(allowListRows2518()); h != "553a24ff81ab764b43cc112fcad37c55fa3b90948cb6c772ef60a43f3f03604d" {
		t.Fatalf("a row other than 2.5.19's changed (%s)", h)
	}
}
