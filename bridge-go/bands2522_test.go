package main

// bridge 2.5.22 (migration 222's partial-list guard, the coordinator's note of 24-Nov-2026): a day listed in bands
// (FinComDayHeadsPart, unchanged) tells FinCom the bands with its list, period_heads "bands": [[from, to], ...], the
// last to null; FinCom takes the list as whole only when they start at 1 and join with no hole. Made-up data only.
import "testing"

func TestBands2522SentWithTheDaysList(t *testing.T) {
	f, _, m := r2519BandDay(t)
	r2519Bands(f, false)
	r2516Person(t, 70)
	applyPeriodDays(pullList("20250831"))
	pullRun(t, 5)
	retryReset()
	pullRun(t, 40)
	asked := r2516Bodies(f, dayPartID)
	var bands []any
	sent := 0
	for _, h := range m.heads {
		if str(h["day"]) == "20250831" && !truthy(h["upload"]) {
			sent++
			if str(h["via"]) != "bands" {
				t.Fatalf("not via bands: %v", h)
			}
			bands = arr(h["bands"])
		}
	}
	if sent != 1 || len(bands) < 2 || len(bands) > len(asked) {
		t.Fatalf("%d lists sent, bands %v (%d asked)", sent, bands, len(asked))
	}
	next := int64(1)
	for i, x := range bands {
		b := arr(x)
		if len(b) != 2 || toI64(b[0]) != next {
			t.Fatalf("band %d does not join (want from %d): %v", i, next, bands)
		}
		if b[1] == nil {
			if i != len(bands)-1 {
				t.Fatalf("an open band before the last: %v", bands)
			}
			break
		}
		if i == len(bands)-1 {
			t.Fatalf("the last band's to is not null: %v", bands)
		}
		next = toI64(b[1]) + 1
	}
	// every head inside a band
	for _, x := range arr(func() any {
		for _, h := range m.heads {
			if str(h["day"]) == "20250831" && !truthy(h["upload"]) {
				return h["heads"]
			}
		}
		return nil
	}()) {
		mid, in := toI64(arr(x)[1]), false
		for _, y := range bands {
			b := arr(y)
			if mid >= toI64(b[0]) && (b[1] == nil || mid <= toI64(b[1])) {
				in = true
			}
		}
		if !in {
			t.Fatalf("head MasterID %d in no band %v", mid, bands)
		}
	}
}

func TestBands2522Body(t *testing.T) {
	got := bandsBody([][2]int64{{1, 200}, {201, 600}, {601, 0}})
	if len(got) != 3 || toI64(arr(got[0])[0]) != 1 || toI64(arr(got[1])[1]) != 600 || arr(got[2])[1] != nil {
		t.Fatalf("%v", got)
	}
	if l := bandsBody(nil); l == nil || len(l) != 0 {
		t.Fatalf("no bands: %v", l)
	}
}
