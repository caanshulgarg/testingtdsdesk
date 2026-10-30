// Bridge 2.5.0 (the owner's decision of 30-Oct-2026): the ledger reads carry the books' first year as their period.
//
// Proven on real TallyPrime 3.0 and 7.1 (tally-versions mode openp, runs 41002898108 and 41004704755): a ledger request
// with no period makes Tally give OPENINGBALANCE as at the start of the Gateway's CURRENT period, not as at the books'
// beginning. A bridge on a computer whose Tally sat in a later year sent each ledger's balance of that later year as its
// opening (book 3d36a836, 30-Oct-2026). So the three ledger requests (FinComLedgers, FinComLedgerChanges,
// FinComLedgerByName) now carry, inside their STATICVARIABLES and nowhere else,
//
//	<SVFROMDATE TYPE="Date">{books-from yyyymmdd}</SVFROMDATE><SVTODATE TYPE="Date">{books-from + 1 year - 1 day}</SVTODATE>
//
// and the company list (TDSDeskCompanies) asks for BOOKSFROM too, so the bridge knows books-from. Nothing else in any
// request changes. A company whose books-from is not known is never read undated: its ledger read is held, said in one
// plain log line, and the company list is read again. With ReadDays off these three requests go only exactly as built,
// with exactly the books' first year of their company (datedRefused, tally.go); every other request carrying a period
// keeps the rule it had.
package main

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var errBooksFromUnknown = errors.New("Tally has not said when this company's books begin: its ledgers are not read until it does")

// a ledger request that does not carry exactly its company's books' first year (or none): never sent, whoever asks and
// whatever ReadDays says
var errLedgerPeriodRefused = errors.New("the ledger request does not carry this company's books' first year as its period; nothing was sent to Tally")

var (
	booksFromMu   sync.Mutex
	booksFromHeld = map[string]string{}    // companyKey -> yyyymmdd, from the company list (TDSDeskCompanies' BOOKSFROM)
	booksFromSaid = map[string]bool{}      // companyKey -> the held read already said in the log (one line until it is known)
	booksFromAsk  = map[string]time.Time{} // companyKey -> when the company list was last read again for it (once a minute)
)

// BOOKSFROM as the company list gave it: kept when it is a date, forgotten when Tally gave none (a list that answered
// without it names the company afresh)
func noteBooksFrom(company, v string) {
	k := companyKey(company)
	if k == "" {
		return
	}
	d := normDate(v)
	booksFromMu.Lock()
	defer booksFromMu.Unlock()
	if isTallyDate(d) {
		booksFromHeld[k] = d
		delete(booksFromSaid, k)
		return
	}
	delete(booksFromHeld, k)
}

// the company's books-from (yyyymmdd); "" when not known. Held from the company list this run; after a restart, from
// the list saved with the open companies (open-companies.json keeps each company's booksFrom)
func booksFromOf(company string) string {
	k := companyKey(company)
	if k == "" {
		return ""
	}
	booksFromMu.Lock()
	d := booksFromHeld[k]
	booksFromMu.Unlock()
	if d != "" {
		return d
	}
	coMu.Lock()
	c := coCache
	coMu.Unlock()
	if c == nil {
		c = sessionsFromFile(filepath.Join(syncDir(), "open-companies.json"))
	}
	for _, s := range c {
		if s["mine"] == false {
			continue // another Windows user's Tally: never the period of this user's reads
		}
		for _, co := range sessCompanies(s) {
			if sameCompany(str(co["name"]), company) {
				if b := normDate(str(co["booksFrom"])); isTallyDate(b) {
					return b
				}
			}
		}
	}
	return ""
}

// the books' first year: books-from to books-from + 1 year - 1 day (yyyymmdd); "" when from is not a date
func booksYearEnd(from string) string {
	t, err := time.Parse("20060102", from)
	if err != nil || !isTallyDate(from) {
		return ""
	}
	return t.AddDate(1, 0, -1).Format("20060102")
}

// the period the three ledger requests carry, exactly as the owner approved it; "" when from is not a date
func ledgerPeriodVars(from string) string {
	to := booksYearEnd(from)
	if to == "" {
		return ""
	}
	return dateVars(formPlainT, from, to)
}

// the three ledger requests: the ids, and whether a request is one of them exactly as built for its company's
// books-from (the period, the company and every other byte; the rebuild is pinned.go's)
var ledgerPeriodIDs = map[string]bool{ledListID: true, ledChangesID: true, ledByNameID: true}

func ledgerPeriodExact(x string) bool {
	id := tallyRequestID(x)
	if !ledgerPeriodIDs[id] {
		return false
	}
	co := pinCo(x)
	bf := booksFromOf(co)
	if bf == "" || !strings.Contains(x, "<STATICVARIABLES>") {
		return false
	}
	a, z := pinDates(x)
	if a != bf || z != booksYearEnd(bf) || strings.Count(x, "<SVFROMDATE") != 1 || strings.Count(x, "<SVTODATE") != 1 {
		return false
	}
	for _, y := range requestRebuild[id](x) {
		if y != "" && y == x {
			return true
		}
	}
	return false
}

// a ledger read for a company whose books-from is not known: held. Said once in the log (until Tally says it), and the
// company list read again (that read itself is the one request; postings still go first through the one gate)
func holdLedgerRead(tc *TC, company string) error {
	k := companyKey(company)
	booksFromMu.Lock()
	said := booksFromSaid[k]
	booksFromSaid[k] = true
	booksFromMu.Unlock()
	if !said {
		writeLog("Ledgers of " + company + " not read: Tally has not said when its books begin; the company list is read again and the ledgers wait until it does")
	}
	if tc == nil {
		tc = fin
	}
	// the company list read again at most once a minute for a company (review: not on every held chunk or ledger)
	booksFromMu.Lock()
	again := booksFromAsk[k].IsZero() || nowFn().Sub(booksFromAsk[k]) >= time.Minute || nowFn().Before(booksFromAsk[k])
	if again {
		booksFromAsk[k] = nowFn()
	}
	booksFromMu.Unlock()
	if again {
		openCompaniesWith(tc, true)
	}
	return errBooksFromUnknown
}

// the books-from of a company, read again once when not known; "" (and errBooksFromUnknown) when still not known
func booksFromForRead(tc *TC, company string) (string, error) {
	if bf := booksFromOf(company); bf != "" {
		return bf, nil
	}
	err := holdLedgerRead(tc, company)
	if bf := booksFromOf(company); bf != "" {
		return bf, nil
	}
	return "", err
}
