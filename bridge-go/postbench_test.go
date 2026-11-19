package main

// The owner's condition for the linked-GUID bridge (19-Nov-2026): posting never slower than before, end to end, at 1,000
// and 20,000 entries. FINCOM_POSTBENCH=1000,20000 go test -run TestPostBench -timeout 60m . (skipped otherwise). The fake
// Tally (the stand-in) answers with a modelled latency: an import 120 ms + 10 ms an entry, the company list and the
// company check 40 ms each; FinCom's post_ok before each part 120 ms. No timing of a real Tally import is in the repo, so
// these are assumptions; FINCOM_POSTBENCH_SCALE (default 1) multiplies every latency, and the part-size target with
// them, so a 20,000-entry run takes minutes, not an hour. The file uses nothing of the linked-GUID branch, so the same
// file runs on the bridge before it (old) and after (new).

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPostBench(t *testing.T) {
	spec := os.Getenv("FINCOM_POSTBENCH")
	if spec == "" {
		t.Skip("FINCOM_POSTBENCH not set")
	}
	scale := 1.0
	if s, err := strconv.ParseFloat(os.Getenv("FINCOM_POSTBENCH_SCALE"), 64); err == nil && s > 0 {
		scale = s
	}
	ms := func(x float64) time.Duration { return time.Duration(x * scale * float64(time.Millisecond)) }
	for _, ns := range strings.Split(spec, ",") {
		n, _ := strconv.Atoi(strings.TrimSpace(ns))
		t.Run(ns, func(t *testing.T) {
			f := newStandTally(t)
			f.slow = func(id, body string) time.Duration {
				switch id {
				case "Import":
					return ms(120 + 10*float64(strings.Count(body, "<VOUCHER ")))
				case "TDSDeskCompanies", "FinComCompany", "FinComFree", cnReportID:
					return ms(40)
				}
				return 0
			}
			standBridge(t, f, fmt.Sprintf(`,"PostWaitMs":100,"PostTargetMs":%d`, int(1350*scale)))
			was := postOKFn
			postOKFn = func(string) (string, bool) { time.Sleep(ms(120)); return "", true }
			t.Cleanup(func() { postOKFn = was })
			var vs []any
			for i := 1; i <= n; i++ {
				id := fmt.Sprintf("pb%06d", i)
				vs = append(vs, M{"id": id, "xml": finVoucher(id, fgParty, "PB-"+id, fgDate, "1.00")})
			}
			_ = openCompanies(true) // the GUID held, as on a running bridge
			t0 := time.Now()
			j, err := newPostJob(M{"jobId": fmt.Sprintf("job-bench-%d", n), "company": zz, "guid": "co-guid-1", "fromCloud": true, "vouchers": vs})
			if err != nil {
				t.Fatal(err)
			}
			dir, _ := jobDir(str(j["id"]))
			for jobAlive(str(j["id"])) { // the job's own file is not read while it runs (it would cost the job itself)
				time.Sleep(20 * time.Millisecond)
			}
			p := readProgress(dir)
			el := time.Since(t0)
			okN := 0
			for _, x := range arr(p["results"]) {
				if obj(x)["ok"] == true {
					okN++
				}
			}
			if okN != n || f.n("Import") == 0 {
				t.Fatalf("posted %d of %d: %q", okN, n, p["message"])
			}
			real := el.Seconds() / scale
			fmt.Printf("POSTBENCH n=%d scale=%.2f imports=%d lists=%d wall=%.1fs modelled-at-scale-1=%.1fs entries/s=%.1f\n", n, scale, f.n("Import"), f.n("TDSDeskCompanies"), el.Seconds(), real, float64(n)/real)
		})
	}
}
