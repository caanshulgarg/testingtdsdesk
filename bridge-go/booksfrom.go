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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// 2.5.13 (live, a company opened in Tally for the first time: FinCom had no first day for the book and Tally's company
// list gave no BOOKSFROM, so its ledgers were never read): the masters need no first day, only their openings do. The
// ledger list's round (FinComLedgers, byte for byte as built) is then dated with the stand-in day below, the first day of
// the current financial year, and FinCom is told that round's openings are not known (none sent, none taken), with these
// words; the next round once a first day is known is dated it and sends every ledger with its opening. The stand-in day
// is allowed only for FinComLedgers and only while no first day is known (ledgerPeriodExact)
const booksFromUnknownWords = "Tally has not said when this company's books begin; set the book's first day in FinCom (the ledgers came without their openings)"

func ledgerStandInDay() string { return tallyDate(fyStart(nowFn())) }

var errBooksFromUnknown = errors.New("Tally has not said when this company's books begin: its ledgers are not read until it does")

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
// company not named keeps what it had, and an answer without booksFrom changes nothing. Review of 2.5.1: a day is kept
// only for a company of this user's own Tally whose books-from Tally has said (so names that are not companies here
// never fill the list; a company already held takes the new day whenever it comes, review round 3); when FinCom's day
// is not Tally's, one log line names both (again when either day changes)
func applyBooksFrom(j M) {
	m, ok := j["booksFrom"].(map[string]any)
	if !ok {
		return
	}
	type cand struct {
		key, name, day, tally string
		listed                bool // 2.5.13: listed by this user's own Tally (with or without its books-from)
	}
	var cs []cand
	n := 0
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
		}
		// Tally's own books-from of the company (outside the lock: tallyBooksFromOf takes it)
		cs = append(cs, cand{k, strings.Join(strings.Fields(co), " "), day, tallyBooksFromOf(co), tallyListsCompany(co)}) // one line: no line break from the answer
	}
	var tell []cand
	booksFromMu.Lock()
	finComFromLoad()
	changed := false
	for _, c := range cs {
		if c.day == "" {
			if _, had := finComFromHeld[c.key]; had {
				delete(finComFromHeld, c.key)
				delete(finComFromSaid, c.key)
				changed = true
			}
			continue
		}
		if _, had := finComFromHeld[c.key]; !had && c.tally == "" && !c.listed {
			continue // not a company of this Tally (yet): named again at the next heartbeat (2.5.13: listed without its books-from: kept)
		}
		if _, had := finComFromHeld[c.key]; !had && len(finComFromHeld) >= 1000 {
			continue // at most 1,000 companies kept
		}
		if finComFromHeld[c.key] != c.day {
			finComFromHeld[c.key], changed = c.day, true
		}
		if c.tally != "" && c.day != c.tally && finComFromSaid[c.key] != c.day+"|"+c.tally {
			finComFromSaid[c.key] = c.day + "|" + c.tally
			tell = append(tell, c)
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
	for _, c := range tell {
		if finComDayFits(c.day, c.tally) {
			writeLog("Ledgers of " + c.name + " are read as at " + dayWords(c.day) + ", FinCom's first day of its books of this company (Tally's books begin on " + dayWords(c.tally) + ")")
		} else {
			writeLog("Ledgers of " + c.name + " are read as at " + dayWords(c.tally) + ", when Tally's books begin: FinCom's books of this company begin on " + dayWords(c.day) + ", before them, so FinCom keeps its opening balances until the two agree")
		}
	}
}

// 2.5.1 (review): FinCom's day is used when it is on or after the day Tally's own books of the company begin (Tally can
// give openings only from its books' beginning on); FinCom's day before it: Tally's, as 2.5.0, and the cloud keeps its
// openings (they are not as at its first day)
func finComDayFits(fc, tally string) bool {
	return isTallyDate(fc) && isTallyDate(tally) && fc >= tally
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
// Review of 2.5.1: FinCom's day only on or after Tally's (finComDayFits), else Tally's; Tally's books-from not known: ""
// (the read is held, 2.5.0's rule)
func booksFromOf(company string) string {
	d, _ := booksFromPair(company)
	return d
}

// the day in use and Tally's own (each "" when not known); Tally's books-from read once
//
// 2.5.13 (the owner's decision of 10-Nov-2026: "we ask the date for uploading"): with Tally's books-from not known, FinCom's
// first day of the book is used as it is (the date the person gave when bringing the books); "not earlier than Tally's"
// holds only when Tally's is known. Neither known: "" (the masters are still read, without their openings: ledgerList)
func booksFromPair(company string) (string, string) {
	t := tallyBooksFromOf(company)
	if t == "" {
		return finComBooksFrom(company), ""
	}
	if d := finComBooksFrom(company); d != "" && finComDayFits(d, t) {
		return d, t
	}
	return t, t
}

// the books' first days a ledger request of the company may carry (ledgerPeriodExact): the one in use, and Tally's own
// (review of 2.5.1: a request built a moment before FinCom's day arrived is not refused; Tally's books-from is 2.5.0's
// rule, the company's own books' first year)
func booksFromAllowed(company string) []string {
	d, t := booksFromPair(company)
	if d == "" {
		return nil
	}
	if d == t || t == "" {
		return []string{d}
	}
	return []string{d, t}
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

// 2.5.13: whether this user's own Tally lists the company (its last company list, or the one saved with the open
// companies), with or without its books-from
func tallyListsCompany(company string) bool {
	if companyKey(company) == "" {
		return false
	}
	coMu.Lock()
	c := coCache
	coMu.Unlock()
	if c == nil {
		c = sessionsFromFile(filepath.Join(syncDir(), "open-companies.json"))
	}
	for _, s := range c {
		if s["mine"] == false {
			continue
		}
		for _, co := range sessCompanies(s) {
			if sameCompany(str(co["name"]), company) {
				return true
			}
		}
	}
	return false
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
	allowed := booksFromAllowed(co)
	if id == ledListID && len(allowed) == 0 {
		allowed = []string{ledgerStandInDay()} // 2.5.13: no first day known: the masters' stand-in day (above)
	}
	for _, bf := range allowed {
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
	booksFromMu.Lock()
	said := booksFromSaid[k]
	booksFromSaid[k] = true
	booksFromMu.Unlock()
	if !said {
		// 2.5.13 (review A2): the masters' own round is read meanwhile (ledgerList's stand-in day), without the openings
		writeLog("Ledgers of " + company + ": Tally has not said when its books begin and FinCom has no first day for the book; the company list is read again; the ledger list is read without its openings, and the openings and single ledgers wait until a first day is known")
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
