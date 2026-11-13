package main

// bridge 2.5.15 after the independent review of next-bridge-safe: L5 and L7, FinCom refusing this bridge stops a posting. Made-up names only.
import (
	"strings"
	"testing"
)

// L5: 401 / 403 from post_ok stops (said in the tray); 500 is no answer: posted, counted
func TestR2515ReviewPostOKRefusedStops(t *testing.T) {
	for _, c0 := range []struct {
		code int
		stop bool
		says string
	}{{401, true, "FinCom refused this computer's key"}, {403, true, "test mode (stand)"}, {500, false, ""}} {
		f, c := r2515QueueBridge(t)
		c.mu.Lock()
		c.other = func(k string, b M) (int, M) {
			if k == "post_ok" {
				return c0.code, M{"ok": false, "error": "FinCom Bridge is in test mode (stand)"}
			}
			return 200, M{"ok": true}
		}
		c.mu.Unlock()
		id := "job-r2515-c" + itoa(c0.code)
		r2515Take(t, c, id, 2)
		p := r2515JobEnd(t, id)
		if c0.stop {
			if str(p["status"]) != "stopped" || f.n("Import") != 0 || !strings.Contains(postingNow(), c0.says) {
				t.Fatalf("%d: %s, %d imports, tray %q", c0.code, p["status"], f.n("Import"), postingNow())
			}
		} else if str(p["status"]) != "done" || f.n("Import") != 2 || toInt(p["offlineSends"]) != 2 {
			t.Fatalf("%d: %s, %d imports, %v counted", c0.code, p["status"], f.n("Import"), p["offlineSends"])
		}
		// L7: nothing kept for a job that ended
		if _, kept := postOKOffline.Load(id); kept {
			t.Fatalf("%d: the job's check state kept after it ended", c0.code)
		}
		notePostStop("")
	}
}
