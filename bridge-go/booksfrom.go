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
// and the company list (TDSDeskCompanies) asks for BOOKSFROM too, so the bridge knows books-from.
//
// Bridge 2.5.1 (book 3d36a836, 30-Oct-2026): the books-from of these three is FinCom's first day of its book of the
// company (the beat's answer, booksFrom {company: yyyymmdd}: tally_books.from_date), and Tally's own BOOKSFROM only when
// FinCom has none. 2.5.0 took Tally's: a Tally whose books begin on 1-Apr-2024 while FinCom's copy begins on 1-Apr-2025
// sent openings as at 1-Apr-2024. The request is byte for byte 2.5.0's; only the date's source changed, and openingsAt
// is the date used. FinCom's day is kept in the sync folder (fincom-books-from.json), so a restart reads it before the
// first beat; the cloud's "" forgets it; an answer naming no booksFrom (a cloud before 2.5.1) changes nothing. Nothing else in any
// request changes. A company whose books-from is not known is never read undated: its ledger read is held, said in one
// plain log line, and the company list is read again. With ReadDays off these three requests go only exactly as built,
// with exactly the books' first year of their company (datedRefused, tally.go); every other request carrying a period
// keeps the rule it had.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var errBooksFromUnknown = errors.New("Tally has not said when this company's books begin: its ledgers are not read until it does")

// 2.5.1 (review): FinCom's first day not a whole number of years on from Tally's own books-from (or Tally's not known):
// the ledgers are not read (one log line), never read as at that day nor as at Tally's
var errFinComDayRefused = fmt.Errorf("%w (FinCom's first day of the book is not a year of Tally's books of this company)", errBooksFromUnknown)

// a ledger request that does not carry exactly its company's books' first year (or none): never sent, whoever asks and
// whatever ReadDays says
var errLedgerPeriodRefused = errors.New("the ledger request does not carry this company's books' first year as its period; nothing was sent to Tally")

var (
	booksFromMu   sync.Mutex
	booksFromHeld = map[string]string{}    // companyKey -> yyyymmdd, from the company list (TDSDeskCompanies' BOOKSFROM)
	booksFromSaid = map[string]bool{}      // companyKey -> the held read already said in the log (one line until it is known)
	booksFromAsk  = map[string]time.Time{} // companyKey -> when the company list was last read again for it (once a minute)

	// 2.5.1: FinCom's first day of its book of each company (the beat's booksFrom), loaded once per sync folder from
	// fincom-books-from.json and saved there on a change (under booksFromMu)
	finComFromHeld = map[string]string{} // companyKey -> yyyymmdd
	finComFromDir  string                // the sync folder finComFromHeld belongs to ("": not loaded yet)
	finComFromSaid = map[string]string{} // companyKey -> FinCom's day already said in the log against Tally's
)

func finComFromFile() string { return filepath.Join(syncDir(), "fincom-books-from.json") }

// a real day as yyyymmdd (FinCom's answer: never a date in another form, never a day that does not exist, never before
// 1-Jan-1990 nor more than a year after today: the period of a read request is never set far from any books' years)
func finComDay(v any) string {
	s, ok := v.(string)
	if !ok || !isTallyDate(s) {
		return ""
	}
	t, err := time.Parse("20060102", s)
	if err != nil || t.Format("20060102") != s || t.Year() < 1990 || t.After(nowFn().AddDate(1, 0, 0)) {
		return ""
	}
	return s
}

// under booksFromMu: the held days of this sync folder (read from the disk once)
func finComFromLoad() {
	d := syncDir()
	if finComFromDir == d {
		return
	}
	finComFromDir, finComFromHeld = d, map[string]string{}
	var m map[string]any
	if b, err := os.ReadFile(finComFromFile()); err == nil && json.Unmarshal(b, &m) == nil {
		for k, v := range m {
			if day := finComDay(v); day != "" && k == companyKey(k) && k != "" {
				finComFromHeld[k] = day
			}
		}
	}
}

// FinCom's first day of its book of the company (yyyymmdd); "" when FinCom has not named one
func finComBooksFrom(company string) string {
	k := companyKey(company)
	if k == "" {
		return ""
	}
	booksFromMu.Lock()
	defer booksFromMu.Unlock()
	finComFromLoad()
	return finComFromHeld[k]
}

// the beat's answer: booksFrom {company: yyyymmdd | ""}. A day is kept (and saved), "" forgets the company's day, a
// company not named keeps what it had, and an answer without booksFrom changes nothing. When FinCom's day is not
// Tally's, one log line names both (again only when FinCom's day changes)
func applyBooksFrom(j M) {
	m, ok := j["booksFrom"].(map[string]any)
	if !ok {
		return
	}
	type said struct{ company, day string }
	var tell []said
	booksFromMu.Lock()
	finComFromLoad()
	changed, n := false, 0
	for co, v := range m {
		if n++; n > 200 {
			break
		}
		k := companyKey(co)
		if k == "" {
			continue
		}
		day := finComDay(v)
		if day == "" {
			if s, isStr := v.(string); !isStr || s != "" {
				continue // not a day: never used, the day held stays
			}
			if _, had := finComFromHeld[k]; had {
				delete(finComFromHeld, k)
				delete(finComFromSaid, k)
				changed = true
			}
			continue
		}
		if _, had := finComFromHeld[k]; !had && len(finComFromHeld) >= 1000 {
			continue // at most 1,000 companies kept (the cloud names only the companies open in Tally)
		}
		if finComFromHeld[k] != day {
			finComFromHeld[k], changed = day, true
		}
		if finComFromSaid[k] != day {
			finComFromSaid[k] = day                                               // looked at once per day named (review: not every beat)
			tell = append(tell, said{strings.Join(strings.Fields(co), " "), day}) // one line: no line break from the answer
		}
	}
	var text []byte
	if changed {
		text, _ = json.Marshal(finComFromHeld)
	}
	booksFromMu.Unlock()
	if changed {
		if err := saveFile(finComFromFile(), string(text)); err != nil {
			writeLog("FinCom's first days of the books not kept on disk (" + err.Error() + "); they are named again at the next heartbeat")
		}
	}
	for _, s := range tell {
		if t := tallyBooksFromOf(s.company); t != "" && t != s.day && finComDayFits(s.day, t) {
			writeLog("Ledgers of " + s.company + " are read as at " + dayWords(s.day) + ", FinCom's first day of its books of this company (Tally's books begin on " + dayWords(t) + ")")
		}
	}
}

// 2.5.1 (review): FinCom's day is used only when it is the first day of a year of Tally's own books of the company: on
// or after Tally's books-from, the same day and month (a whole number of years on). The period of a ledger read is then
// always one of the company's own books' years, as 2.5.0's rule; FinCom's day never moves it elsewhere
func finComDayFits(fc, tally string) bool {
	return isTallyDate(fc) && isTallyDate(tally) && fc >= tally && fc[4:] == tally[4:]
}

func dayWords(d string) string {
	t, err := time.Parse("20060102", d)
	if err != nil {
		return d
	}
	return t.Format("2-Jan-2006")
}

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

// 2.5.1: the books-from the three ledger requests carry: FinCom's first day of its book of the company, else Tally's own
// (tallyBooksFromOf); "" when neither is known
//
// Review of 2.5.1: FinCom's day that does not fit Tally's books (finComDayFits), or with Tally's books-from not known:
// "" (the read is held, said once: holdLedgerRead), never Tally's day instead
func booksFromOf(company string) string {
	t := tallyBooksFromOf(company)
	if d := finComBooksFrom(company); d != "" {
		if finComDayFits(d, t) {
			return d
		}
		return ""
	}
	return t
}

// the books' first days a ledger request of the company may carry (ledgerPeriodExact): the one in use, and Tally's own
// (review of 2.5.1: a request built a moment before FinCom's day arrived is not refused; Tally's books-from is the
// company's own books' first year, 2.5.0's rule)
func booksFromAllowed(company string) []string {
	var o []string
	for _, d := range []string{booksFromOf(company), tallyBooksFromOf(company)} {
		if d != "" && (len(o) == 0 || o[0] != d) {
			o = append(o, d)
		}
	}
	return o
}

// why FinCom's day is not used for the company ("" when it is, or FinCom has none)
func finComDayWhy(company string) string {
	d := finComBooksFrom(company)
	if d == "" {
		return ""
	}
	t := tallyBooksFromOf(company)
	if t == "" {
		return "" // Tally has not said when its books begin: 2.5.0's held read and words
	}
	if finComDayFits(d, t) {
		return ""
	}
	return "FinCom's books of this company begin on " + dayWords(d) + ", which is not the first day of a year of Tally's books (Tally's books begin on " + dayWords(t) + "); the ledgers wait until the two agree"
}

// Tally's own books-from of the company (yyyymmdd); "" when not known. Held from the company list this run; after a
// restart, from the list saved with the open companies (open-companies.json keeps each company's booksFrom)
func tallyBooksFromOf(company string) string {
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
	if !strings.Contains(x, "<STATICVARIABLES>") {
		return false
	}
	a, z := pinDates(x)
	okDay := false
	for _, bf := range booksFromAllowed(co) {
		if a == bf && z == booksYearEnd(bf) {
			okDay = true
		}
	}
	if !okDay || strings.Count(x, "<SVFROMDATE") != 1 || strings.Count(x, "<SVTODATE") != 1 {
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
	// 2.5.1 (review): FinCom's day does not fit Tally's books: said once per reason, the company list not read again
	if why := finComDayWhy(company); why != "" {
		booksFromMu.Lock()
		said := booksFromSaid[k+"|fc|"+why]
		booksFromSaid[k+"|fc|"+why] = true
		booksFromMu.Unlock()
		if !said {
			writeLog("Ledgers of " + company + " not read: " + why)
		}
		return errFinComDayRefused
	}
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
