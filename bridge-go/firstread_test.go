package main

// next-fix-first-read (07-Nov-2026, staging): an Update now never read a linked company open in Tally: the run waited
// "a posting into Tally is going on" behind a posting that was only WAITING for Tally (for another company, the cloud
// having failed it days before). The run's gate counted every job folder that was queued, waiting, running or
// interrupted (activeJobs); every other reader of Tally waits only for a posting actually going (postingGoing). The run
// now does the same: a posting that waits, or one stopped part-way, no longer holds the ledger read; one that is
// starting or sending still does.

import (
	"os"
	"testing"
	"time"
)

// a posting job here in the given state, its worker alive or not
func standJob(t *testing.T, id, status string, alive bool) {
	dir, err := jobDir(id)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(dir, 0o755)
	if err := writeProgress(dir, M{"id": id, "status": status, "company": "ZZ OTHER CO", "message": "Waiting for Tally: ZZ OTHER CO is not open", "updatedAt": time.Now().Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	jobsMu.Lock()
	jobsRunning[id] = alive
	jobsMu.Unlock()
	t.Cleanup(func() {
		jobsMu.Lock()
		delete(jobsRunning, id)
		jobsMu.Unlock()
		_ = os.RemoveAll(dir)
	})
}

func firstReadRun(t *testing.T, f *standTally, c *standCloud) {
	wakeUpdate("")
	for i := 0; i < 80 && keepStateOf(zz) == nil; i++ {
		time.Sleep(100 * time.Millisecond)
	}
}

func TestWaitingPostingDoesNotHoldFirstRead(t *testing.T) {
	for _, x := range []struct {
		status string
		alive  bool
	}{{"waiting", true}, {"interrupted", false}} {
		t.Run(x.status, func(t *testing.T) {
			f := newStandTally(t)
			c := newStandCloud(t)
			standBridge(t, f, c.cfg())
			standJob(t, "job-"+x.status, x.status, x.alive)
			if postingGoing() {
				t.Fatalf("%s: the stand's job counts as a posting going", x.status)
			}
			firstReadRun(t, f, c)
			if st := keepStateOf(zz); st == nil || str(st["phase"]) != "live" {
				t.Fatalf("a posting %s for another company holds the first read of an open company (keepWait %v)", x.status, keepWaitBeat())
			}
			waitIdle(t)
		})
	}
}

func TestPostingGoingStillHoldsTheRead(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	standJob(t, "job-running", "running", true)
	if !postingGoing() {
		t.Fatal("the stand's running job is not a posting going")
	}
	firstReadRun(t, f, c)
	if st := keepStateOf(zz); st != nil {
		t.Fatalf("the run read while a posting was being sent: %v", st)
	}
	if kw := obj(keepWaitBeat()); str(kw["reason"]) != "posting" {
		t.Fatalf("the wait is not said as a posting: %v", kw)
	}
	// the posting over: the run reads
	jobsMu.Lock()
	jobsRunning["job-running"] = false
	jobsMu.Unlock()
	dir, _ := jobDir("job-running")
	_ = writeProgress(dir, M{"id": "job-running", "status": "done", "company": "ZZ OTHER CO", "updatedAt": time.Now().Format(time.RFC3339Nano)})
	waitIdle(t)
	if st := keepStateOf(zz); st == nil {
		t.Fatal("after the posting the run did not read")
	}
}
