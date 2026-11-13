"""next-tally-own-status (13-Nov-2026): each person sees only THEIR OWN Tally. A test whose made-up computer stands for the
signed-in person's own Tally computer says so: its bridge is the one this browser found here before (remembered, as
lib/ownBridge.js keeps it). OWN: ([bridge id, Windows user]) => remembered; an empty id forgets it (a computer with
no bridge of its own)."""
OWN = """([id, user]) => { try { const k = ((typeof LocalOwner === 'object' && LocalOwner && LocalOwner.P) || 'tdsdesk:') + 'ownbridge';
  if (id) localStorage.setItem(k, JSON.stringify({id, port: 0, user: user || ''})); else localStorage.removeItem(k); } catch (e) {} }"""
# OWN_DEV: (a made-up computer of the test, or null) => its main bridge (else its first) remembered as this person's own
OWN_DEV = """(d) => { try { const k = ((typeof LocalOwner === 'object' && LocalOwner && LocalOwner.P) || 'tdsdesk:') + 'ownbridge';
  const br = (d && d.info && d.info.bridges) || {}, id = d ? (br[d.main_bridge] ? d.main_bridge : Object.keys(br)[0]) || '' : '';
  if (id) localStorage.setItem(k, JSON.stringify({id, port: 0, user: (br[id] || {}).user || (d.info || {}).user || ''})); else localStorage.removeItem(k); } catch (e) {} }"""
