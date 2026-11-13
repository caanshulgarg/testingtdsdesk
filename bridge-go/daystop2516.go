package main

// FinCom Bridge 2.5.16 (the 2.5.17 plan, item 2; the owner's YES of 13-Nov-2026: "stops lift by themselves", the safety
// limits kept). Before, one slow day stopped the whole period of the company until the person chose again
// (pullStopCompany), a row of another date stopped single days on that Tally until the bridge restarted, and a company
// marked slow stayed marked until a new bridge version. Now:
//   - a day whose list or entry is stopped at 2 s, or whose read held Tally's window 2 s, stops only that day: FinCom is
//     told (period_day_stop, migration 197) and does not hand it out for 24 hours; here it is not asked for 24 hours
//     either (kept in period-upload.json "retry"). It is then tried again only in the heavy tier (Tally left alone a
//     minute). On the 3rd separate day that fails FinCom marks it to upload, and only then is the person asked. A cloud
//     without 197 (503 notReady, 400 unknown kind): the period is stopped as before;
//   - a row of another date in a day's list is skipped (the day's own rows are taken); a list with no row of the day
//     asked is a day not read, asked again later, never a stop;
//   - a slow mark lifts after 24 hours by itself (slowco.go): the company's entries are measured again, each request
//     under its 2 s stop;
//   - a period stopped by an earlier bridge lifts here after 24 hours (FinCom's own stop still holds until the person
//     chooses again or FinCom lifts it).
// Nothing new is asked of Tally.

import (
	"fmt"
	"strings"
	"time"
)

const pullRetryHold = 24 * time.Hour

func pullRetryWords(it pullItem) string {
	return "Tally was slow for " + liveDay(it.Day) + "; FinCom tries it again tomorrow (no action needed)."
}

// the day stops for 24 hours; the other days go on. why: over2s | window | dates (a failed day: counted toward the 3,
// and toward the company's brake) or split (read type by type: its one-day list is asked again a day later; FinCom
// never closes a day on a split list, and counts the day toward the 3, so a day whose whole list never comes in time
// is offered for upload on the 3rd; not toward the brake)
func pullStopDay(w *pullWork, why, what string) {
	it := w.it
	words := pullRetryWords(it)
	if why == "split" {
		words = liveDay(it.Day) + " was read one voucher type at a time; FinCom checks the whole day again tomorrow (no action needed)."
	}
	body := M{"kind": "period_day_stop", "company": it.Company, "company_guid": it.CGUID, "day": it.Day, "why": why, "words": words, "chosenAt": it.ChosenAt, "pick": it.Kind}
	r := invokeCloud(body, 10)
	older := r.code == 503 && r.json != nil && truthy(r.json["notReady"]) ||
		r.code == 400 && r.json != nil && strings.Contains(str(r.json["error"]), "unknown kind")
	if older && why != "split" {
		pullStopCompany(w, why, what) // a cloud without migration 197: as before
		return
	}
	if why != "split" {
		pullBrakeNote(it)
	}
	writeLog(fmt.Sprintf("Older entries of %s: %s stopped (%s): this day only; asked again after 24 hours, while Tally is left alone; the other days go on", it.Company, liveDay(it.Day), what))
	if r.code == 200 && r.json != nil && truthy(r.json["ok"]) && truthy(r.json["upload"]) {
		// the 3rd separate day it failed: FinCom marked it to upload (its words); never asked again by itself
		pullRetryDrop(it)
		pullNoteUpload(it, "slow3", or(str(r.json["words"]), "Tally could not send "+liveDay(it.Day)+" in time on 3 days. Upload that day's Day Book to finish it."))
		pullFinish(w, "upload")
		return
	}
	fails := 0
	if r.json != nil {
		fails = toInt(r.json["fails"])
	}
	pull.mu.Lock()
	pull.retry[it.key()] = M{"company": it.Company, "day": it.Day, "why": why, "words": words, "fails": fails, "atN": nowFn().UnixNano(), "untilN": nowFn().Add(pullRetryHold).UnixNano()}
	pullSaveLocked()
	pull.mu.Unlock()
	pullFinish(w, "retry")
	if !older && !(r.code == 200 && r.json != nil && truthy(r.json["ok"])) {
		pullTell("daystop|"+it.key(), body) // told again until FinCom takes it (the day is held here meanwhile)
	}
}

// 2.5.16 (the code review's L2): a company whose days failed 3 times within an hour waits an hour (its days are not
// asked; the other companies go on)
const (
	pullBrakeStops = 3
	pullBrakeSpan  = time.Hour
)

func pullBrakeNote(it pullItem) {
	k := pullEmpKey(it)
	now := nowFn()
	pull.mu.Lock()
	var keep []time.Time
	for _, t := range pull.brake[k] {
		if now.Sub(t) < pullBrakeSpan && !now.Before(t) {
			keep = append(keep, t)
		}
	}
	keep = append(keep, now)
	pull.brake[k] = keep
	on := len(keep) == pullBrakeStops
	pull.mu.Unlock()
	if on {
		writeLog(fmt.Sprintf("Older entries of %s: Tally was too slow for %d days of it within an hour: its older days wait an hour; the other companies go on", it.Company, pullBrakeStops))
	}
}

// the company waits: its last pullBrakeStops day stops all within an hour, the last under an hour ago
func pullBraked(it pullItem) bool {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	l := pull.brake[pullEmpKey(it)]
	if len(l) < pullBrakeStops {
		return false
	}
	first, last, now := l[len(l)-pullBrakeStops], l[len(l)-1], nowFn()
	return last.Sub(first) < pullBrakeSpan && now.Sub(last) < pullBrakeSpan && !now.Before(last)
}

// the day is held here now (its 24 hours not over)
func pullRetryHeld(it pullItem) bool {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return pullRetryHeldLocked(it)
}

func pullRetryHeldLocked(it pullItem) bool {
	e := pull.retry[it.key()]
	return e != nil && nowFn().UnixNano() < toI64(e["untilN"])
}

// the day was held once: tried again in the heavy tier only
func pullRetryOnce(it pullItem) bool {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return pull.retry[it.key()] != nil
}

func pullRetryDrop(it pullItem) {
	pull.mu.Lock()
	if _, ok := pull.retry[it.key()]; ok {
		delete(pull.retry, it.key())
		pullSaveLocked()
	}
	pull.mu.Unlock()
}

// under pull.mu: the holds kept no longer than 7 days after they end (FinCom keeps its own count)
func pullRetryTrimLocked() {
	for k, e := range pull.retry {
		if nowFn().UnixNano()-toI64(e["untilN"]) > int64(7*24*time.Hour) {
			delete(pull.retry, k)
		}
	}
}

// for the beat: the days held now [{company, day, why, words, until}]
func pullRetryBeatLocked() []any {
	out := []any{}
	for _, e := range pull.retry {
		if nowFn().UnixNano() < toI64(e["untilN"]) {
			out = append(out, M{"company": e["company"], "day": e["day"], "why": e["why"], "words": e["words"], "until": time.Unix(0, toI64(e["untilN"])).UTC().Format(time.RFC3339)})
		}
		if len(out) >= 50 {
			break
		}
	}
	return out
}

// the rows of a day's list: those of the day asked; the rows of another date skipped (how many, and the first such date)
func pullRowsSkip(raw, day string) (rows []pullHead, skipped int, other string) {
	raw = reCmpInfo.ReplaceAllString(raw, "")
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		one, bad := pullRowsOf(b, day)
		if bad != "" {
			skipped++
			if other == "" {
				other = bad
			}
			continue
		}
		rows = append(rows, one...)
	}
	return rows, skipped, other
}
