"""The fakes of Ask FinCom's voice in the page (the browser's recogniser, MediaRecorder, getUserMedia, the level meter) and the
signed-in firm, shared by run_voice_whisper.py and run_no_device_ui.py. window.__level is the level meter's input: a quiet
room's noise (0.006) by default, 0.1 speech, 0 no sound at all (a silent Remote Desktop microphone)."""
FAKES = """(() => {
  window.__recs = [];
  class FakeRec {
    constructor(){ this.lang = ''; this.state = 'new'; window.__recs.push(this); }
    start(){ this.state = 'listening'; }
    stop(){ if (this.state !== 'listening') return; this.state = 'stopped'; if (this.onend) this.onend(); }
    abort(){ if (this.state !== 'listening') return; this.state = 'aborted'; if (this.onerror) this.onerror({error: 'aborted'}); if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  window.__rec = () => window.__recs[window.__recs.length - 1];
  window.__say = (parts) => { const r = window.__rec(); r.onresult({resultIndex: 0, results: parts.map(([t, fin]) => Object.assign([{transcript: t, confidence: .9}], {isFinal: !!fin}))}); };
  // MediaRecorder: each recorder's file is "clip<n>" (n: the n-th recorder made), handed over when it stops
  window.__mr = []; window.__tracksStopped = 0;
  class FakeMR {
    constructor(stream, o){ this.mimeType = (o && o.mimeType) || 'audio/webm'; this.opts = o || {}; this.state = 'inactive'; this.n = window.__mr.length; window.__mr.push(this); }
    static isTypeSupported(t){ return true; }
    start(){ this.state = 'recording'; }
    stop(){ if (this.state === 'inactive') return; this.state = 'inactive'; setTimeout(() => { if (this.ondataavailable) this.ondataavailable({data: new Blob(['clip' + this.n], {type: this.mimeType})}); if (this.onstop) this.onstop(); }, 20); }
  }
  window.MediaRecorder = FakeMR;
  window.__gumError = '';
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async (c) => { window.__gumArgs = c; if (window.__gumError) throw Object.assign(new Error('mic'), {name: window.__gumError}); return {getTracks: () => [{stop(){ window.__tracksStopped++; }}]}; };
  // the level meter's input: window.__level (0.006 a quiet room, 0.1 speech, 0 no sound at all)
  window.__level = 0.006;
  class FakeAC { createMediaStreamSource(){ return {connect(){}}; } createAnalyser(){ return {fftSize: 1024, getFloatTimeDomainData(a){ a.fill(window.__level); }}; } close(){} }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
})()"""
SETUP = """() => {
  Cloud.cfg = () => ({url: "https://stand.supabase.co", key: "anon-key", email: "me@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => []; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); localStorage.setItem("tdsdesk:asst-voice-note", "1"); } catch (e) {}
  const c = newCompany({name: "Leads Insurance Private Limited", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o); return new Promise(() => {}); };
  return ASST.loadSettings(true).then(() => c.id);
}"""
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS"}
