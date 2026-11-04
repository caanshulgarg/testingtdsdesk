// FinCom Bridge 2.5.4: Windows' list of programs and its listener / connection tables are read at most once in
// snapTTL (1.5 s) and shared. Before 2.5.4 every caller (tallyRunning, portPlan, tallyListeners, platTallyYoung, the
// window check, /ping's user and session checks...) took its own full snapshot: on a shared server with many users and
// several bridges that is many full snapshots a second. Nothing is sent to Tally for any of it.
//
// One reader at a time (the others wait for its result, never for a second read). A caller that needs a table taken
// after a moment (notBefore: the connection to /ping was accepted then) never gets an older one: a connection is only
// ever looked up in a table taken while it was open, so a cached row can never stand for another program's newer
// connection on the same ports.
package main

import (
	"context"
	"net"
	"net/http"
	"sync"
	"time"
)

const snapTTL = 1500 * time.Millisecond

type snapCache[T any] struct {
	mu   sync.Mutex
	at   time.Time // when the held value was taken (its read started)
	v    T
	ok   bool
	fill func() (T, bool)
	now  func() time.Time
}

func newSnapCache[T any](fill func() (T, bool)) *snapCache[T] {
	return &snapCache[T]{fill: fill, now: time.Now}
}

// the value held when it is younger than snapTTL and was taken at notBefore or later; else read afresh (once, under the
// lock: callers arriving meanwhile take that read). A failed read is not kept
func (c *snapCache[T]) get(notBefore time.Time) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.ok && now.Sub(c.at) < snapTTL && !c.at.Before(notBefore) {
		return c.v, true
	}
	v, ok := c.fill()
	if ok {
		c.v, c.at, c.ok = v, now, true
	} else {
		c.ok = false
	}
	return v, ok
}

// forget what is held (the tests)
func (c *snapCache[T]) reset() {
	c.mu.Lock()
	c.ok, c.at = false, time.Time{}
	c.mu.Unlock()
}

// --- the moment a connection to the bridge was accepted (http.Server.ConnContext), for /ping's checks
type acceptedAtKey struct{}

func withAcceptTime(ctx context.Context, _ net.Conn) context.Context {
	return context.WithValue(ctx, acceptedAtKey{}, time.Now())
}

// when the request's connection was accepted; now when not known (then a table is read afresh)
func acceptedAt(r *http.Request) time.Time {
	if r == nil {
		return time.Now()
	}
	if t, ok := r.Context().Value(acceptedAtKey{}).(time.Time); ok {
		return t
	}
	return time.Now()
}
