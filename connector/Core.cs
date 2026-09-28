// FinCom Connector: the Windows app that keeps FinCom's Tally Bridge running on a computer with Tally.
// It is the bridge's minder, not a new bridge: the tested engine (TDSBridge.ps1) still talks to Tally; this app
//   - installs itself and the engine for the signed-in Windows user (no admin rights), and starts with Windows;
//   - starts the engine hidden, checks it every few seconds, and starts it again if it stops or stops answering;
//   - shows what is going on: Tally, the companies kept in step, the cloud, the load on Tally, the log;
//   - checks the computer (Tally open, its port, disk space, internet, a blocked script) and says what to do in plain words;
//   - updates the engine and itself from FinCom, checking each file's SHA-256, and goes back to the previous version if
//     the new one does not start;
//   - sends the log and details to FinCom support in one click.
// Built for the .NET Framework 4.8 that comes with Windows 10 and 11, so nothing else needs installing.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace FinCom.Connector
{
    public static class App
    {
        public const string Version = "1.0.0";
        public const string Name = "FinCom Connector";
        public static readonly bool IsWindows = Environment.OSVersion.Platform == PlatformID.Win32NT;
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };

        // everything lives in the bridge's own folder, so an existing bridge's settings and copies carry over
        public static string Home
        {
            get
            {
                var h = Environment.GetEnvironmentVariable("FINCOM_HOME");
                if (!string.IsNullOrEmpty(h)) return h;
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TDS Desk Bridge");
            }
        }
        public static string Engine { get { return Path.Combine(Home, "TDSBridge.ps1"); } }
        public static string ConfigFile { get { return Path.Combine(Home, "tds-bridge.config.json"); } }
        public static string BridgeLog { get { return Path.Combine(Home, "tds-bridge.log"); } }
        public static string OwnLog { get { return Path.Combine(Home, "connector.log"); } }
        public static string Settings { get { return Path.Combine(Home, "connector.json"); } }
        public static string Exe { get { return Path.Combine(Home, "FinComConnector.exe"); } }
        public static string SyncDir
        {
            get
            {
                var c = Config();
                var s = c.ContainsKey("SyncDir") ? Convert.ToString(c["SyncDir"]) : "";
                return string.IsNullOrEmpty(s) ? Path.Combine(Home, "sync") : s;
            }
        }
        public static string PowerShell
        {
            get
            {
                var p = Environment.GetEnvironmentVariable("FINCOM_PWSH");
                if (!string.IsNullOrEmpty(p)) return p;
                var win = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
                return Path.Combine(win, @"System32\WindowsPowerShell\v1.0\powershell.exe");
            }
        }

        static readonly object logLock = new object();
        public static void Log(string msg)
        {
            try
            {
                lock (logLock)
                {
                    Directory.CreateDirectory(Home);
                    var f = OwnLog;
                    if (File.Exists(f) && new FileInfo(f).Length > 2 * 1024 * 1024) { var old = f + ".1"; if (File.Exists(old)) File.Delete(old); File.Move(f, old); }
                    File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine);
                }
            }
            catch { }
        }

        public static Dictionary<string, object> ReadJson(string path)
        {
            try
            {
                if (!File.Exists(path)) return new Dictionary<string, object>();
                var t = File.ReadAllText(path, Encoding.UTF8).TrimStart('\uFEFF');
                return Json.Deserialize<Dictionary<string, object>>(t) ?? new Dictionary<string, object>();
            }
            catch { return new Dictionary<string, object>(); }
        }
        public static Dictionary<string, object> Config() { return ReadJson(ConfigFile); }
        public static Dictionary<string, object> Prefs() { return ReadJson(Settings); }
        public static void SavePrefs(Dictionary<string, object> p)
        {
            try { Directory.CreateDirectory(Home); File.WriteAllText(Settings, Json.Serialize(p), new UTF8Encoding(false)); } catch (Exception e) { Log("Could not save settings: " + e.Message); }
        }
        public static string Pref(string k, string def)
        {
            var p = Prefs(); object v;
            return p.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : def;
        }
        public static int Port
        {
            get { var c = Config(); object v; int n; return c.TryGetValue("Port", out v) && int.TryParse(Convert.ToString(v), out n) && n > 0 ? n : 9100; }
        }
        // updates come only from FinCom's own sites, over https (a changed setting pointing elsewhere is ignored)
        public const string DefaultUpdateUrl = "https://staging.fincom.live/assets/connector/latest.json";
        public static readonly string[] UpdateHosts = { "staging.fincom.live", "app.fincom.live", "fincom.live", "www.fincom.live" };
        public static bool AllowedUrl(string u)
        {
            Uri x;
            if (!Uri.TryCreate(u ?? "", UriKind.Absolute, out x)) return false;
            if (Environment.GetEnvironmentVariable("FINCOM_TEST") == "1" && x.Scheme == "http" && x.Host == "127.0.0.1") return true;
            return x.Scheme == "https" && UpdateHosts.Contains(x.Host.ToLowerInvariant());
        }
        public static string UpdateUrl { get { var u = Pref("updateUrl", DefaultUpdateUrl); return AllowedUrl(u) ? u : DefaultUpdateUrl; } }
        public static string OpenUrl { get { return Pref("appUrl", "https://staging.fincom.live/"); } }

        public static string Sha256(byte[] b)
        {
            using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(b)).Replace("-", "").ToLowerInvariant();
        }
        public static string EngineVersionOf(string text)
        {
            var m = System.Text.RegularExpressions.Regex.Match(text ?? "", @"\$BridgeVersion\s*=\s*'([0-9.]+)'");
            return m.Success ? m.Groups[1].Value : "";
        }
        public static int CompareVersions(string a, string b)
        {
            var x = (a ?? "").Split('.'); var y = (b ?? "").Split('.');
            for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
            {
                int p = 0, q = 0;
                if (i < x.Length) int.TryParse(x[i], out p);
                if (i < y.Length) int.TryParse(y[i], out q);
                if (p != q) return p.CompareTo(q);
            }
            return 0;
        }
        public static string Tail(string path, int maxBytes)
        {
            try
            {
                if (!File.Exists(path)) return "";
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var n = (int)Math.Min(fs.Length, maxBytes);
                    fs.Seek(-n, SeekOrigin.End);
                    var b = new byte[n]; int got = 0;
                    while (got < n) { var r = fs.Read(b, got, n - got); if (r <= 0) break; got += r; }
                    return Encoding.UTF8.GetString(b, 0, got);
                }
            }
            catch (Exception e) { return "(could not read " + Path.GetFileName(path) + ": " + e.Message + ")"; }
        }
    }

    // ---------------------------------------------------------------- talking to the engine on 127.0.0.1
    public static class Bridge
    {
        public static string Key { get { var c = App.Config(); object v; return c.TryGetValue("Key", out v) ? Convert.ToString(v) : ""; } }
        public static Dictionary<string, object> Call(string path, string body = null, int timeoutMs = 8000)
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + App.Port + path);
            req.Timeout = timeoutMs; req.ReadWriteTimeout = timeoutMs; req.Proxy = null; req.KeepAlive = false;
            req.Headers.Add("X-Bridge-Key", Key);
            req.Headers.Add("Origin", "http://localhost");
            if (body != null)
            {
                req.Method = "POST"; req.ContentType = "application/json";
                var b = Encoding.UTF8.GetBytes(body); req.ContentLength = b.Length;
                using (var s = req.GetRequestStream()) s.Write(b, 0, b.Length);
            }
            try
            {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return App.Json.Deserialize<Dictionary<string, object>>(sr.ReadToEnd()) ?? new Dictionary<string, object>();
            }
            catch (WebException e)
            {
                if (e.Response == null) throw;
                using (var sr = new StreamReader(e.Response.GetResponseStream(), Encoding.UTF8))
                {
                    var t = sr.ReadToEnd(); Dictionary<string, object> o = null;
                    try { o = App.Json.Deserialize<Dictionary<string, object>>(t); } catch { }
                    object err = null;
                    throw new Exception(o != null && o.TryGetValue("error", out err) ? Convert.ToString(err) : e.Message);
                }
            }
        }
        // the engine's version when it answers, else null
        public static string Ping()
        {
            try { var r = Call("/ping", null, 4000); object v; return r.TryGetValue("version", out v) ? Convert.ToString(v) : "?"; }
            catch { return null; }
        }
    }

    // ---------------------------------------------------------------- keeping the engine running
    public class Supervisor
    {
        public static readonly Supervisor Current = new Supervisor();
        Process proc;
        Thread thread;
        volatile bool stopping;
        public volatile bool Paused;
        public volatile string State = "starting";        // running, starting, restarting, stopped, blocked
        public volatile string EngineVersion = "";
        public DateTime LastOk = DateTime.MinValue;
        public int Restarts;
        int fails, quickExits, noticedExit = -1;
        bool everStarted;
        DateTime nextStart = DateTime.MinValue, startedAt = DateTime.MinValue;
        static readonly int[] backoff = { 5, 10, 30, 60, 120 };
        public int IntervalSec = 10;

        public void Start()
        {
            if (thread != null) return;
            stopping = false;
            thread = new Thread(Loop) { IsBackground = true, Name = "engine minder" };
            thread.Start();
        }
        public void Stop() { stopping = true; KillEngine("the Connector is closing"); }

        void Loop()
        {
            while (!stopping)
            {
                try { Tick(); } catch (Exception e) { App.Log("Minder: " + e.Message); }
                for (int i = 0; i < IntervalSec * 10 && !stopping; i++) Thread.Sleep(100);
            }
        }

        public void Tick()
        {
            if (Paused) { State = "stopped"; return; }
            var v = Bridge.Ping();
            if (v != null)
            {
                EngineVersion = v; LastOk = DateTime.Now; fails = 0;
                if (State != "running") App.Log("Bridge " + v + " is answering");
                State = "running";
                if ((DateTime.Now - startedAt).TotalMinutes > 5) quickExits = 0;
                return;
            }
            fails++;
            bool dead = proc == null || proc.HasExited;
            if (!dead && fails < 3) { State = "not answering"; return; }        // give a busy engine half a minute
            if (!dead) KillEngine("it stopped answering");
            // a bridge that stopped within 20 seconds of starting, counted once for each time it stopped
            if (proc != null && proc.HasExited && noticedExit != proc.Id)
            {
                noticedExit = proc.Id;
                if ((proc.ExitTime - startedAt).TotalSeconds < 20) quickExits++; else quickExits = 0;
            }
            if (quickExits >= 3)
            {
                State = "blocked";
                if (quickExits == 3) App.Log("The bridge stops as soon as it starts, three times: Windows or an antivirus may be blocking PowerShell scripts, or another program holds port " + App.Port + ".");
                if (DateTime.Now < nextStart) return;
                nextStart = DateTime.Now.AddMinutes(5);          // still try now and then, slowly
            }
            else if (DateTime.Now < nextStart) { State = "restarting"; return; }
            StartEngine();
            nextStart = DateTime.Now.AddSeconds(backoff[Math.Min(Restarts, backoff.Length - 1)]);
        }

        public void StartEngine()
        {
            if (!File.Exists(App.Engine)) { State = "blocked"; App.Log("The bridge file is missing: " + App.Engine); return; }
            var args = "-NoLogo -NoProfile -ExecutionPolicy Bypass " + (App.IsWindows ? "-WindowStyle Hidden " : "") + "-File \"" + App.Engine + "\"";
            var psi = new ProcessStartInfo(App.PowerShell, args) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = App.Home };
            try
            {
                proc = Process.Start(psi); startedAt = DateTime.Now; State = "starting";
                if (everStarted) Restarts++;
                everStarted = true;
                App.Log("Started the bridge (process " + proc.Id + ")");
            }
            catch (Exception e) { State = "blocked"; App.Log("Could not start the bridge: " + e.Message); }
        }
        // for the self-test: the engine stops as if it had crashed, and the minder is not told
        public void SimulateCrash() { try { if (proc != null && !proc.HasExited) proc.Kill(); } catch { } }
        public void KillEngine(string why)
        {
            try { if (proc != null && !proc.HasExited) { App.Log("Stopping the bridge: " + why); proc.Kill(); proc.WaitForExit(5000); } } catch { }
            // the engine's own worker (keeping copies in step) stops when the engine is gone; it holds no locks
        }
        public void Restart(string why)
        {
            KillEngine(why);
            // a bridge started some other way (the old setup) answers on the port too: ask it to stop
            if (Bridge.Ping() != null) { try { Bridge.Call("/shutdown", "{}", 3000); } catch { } Thread.Sleep(1500); }
            nextStart = DateTime.MinValue; fails = 3; quickExits = 0;
            Tick();
        }
        public bool WaitFor(Func<string, bool> ok, int seconds)
        {
            var until = DateTime.Now.AddSeconds(seconds);
            while (DateTime.Now < until) { var v = Bridge.Ping(); if (v != null && ok(v)) { EngineVersion = v; return true; } Thread.Sleep(1000); }
            return false;
        }
    }

    // ---------------------------------------------------------------- what is going on, in plain words
    public class Check
    {
        public string Name, Level, Say, Fix;          // Level: ok, warn, bad
        public Check(string n, string l, string s, string f = "") { Name = n; Level = l; Say = s; Fix = f; }
    }
    public static class Doctor
    {
        static object Get(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
        public static List<Check> Run()
        {
            var list = new List<Check>();
            var sup = Supervisor.Current;
            var v = Bridge.Ping();
            if (v != null) list.Add(new Check("Tally Bridge", "ok", "Running, version " + v + "."));
            else if (sup.State == "blocked") list.Add(new Check("Tally Bridge", "bad", "It stops as soon as it starts.", "Windows or an antivirus may be blocking PowerShell scripts. Add the folder " + App.Home + " to the antivirus exceptions, or ask your IT person to allow it. Then press Restart."));
            else list.Add(new Check("Tally Bridge", "bad", "Not answering yet (" + sup.State + ").", "Wait a minute; it starts again by itself. If it stays like this, press Restart, then Send to FinCom support."));

            Dictionary<string, object> st = null;
            if (v != null) { try { st = Bridge.Call("/status", null, 15000); } catch (Exception e) { list.Add(new Check("Tally", "warn", "The bridge could not say: " + e.Message)); } }
            // Tally itself
            bool tallyProc = false;
            try { tallyProc = Process.GetProcessesByName("tally").Length > 0 || Process.GetProcessesByName("TallyPrime").Length > 0; } catch { }
            if (st != null)
            {
                var up = false;
                var cos = new List<string>();
                var sessions = Get(st, "sessions") as System.Collections.ArrayList;
                if (sessions != null) foreach (Dictionary<string, object> s in sessions)
                {
                    if (Convert.ToBoolean(Get(s, "skipped") ?? false)) continue;
                    if (Convert.ToBoolean(Get(s, "ok") ?? false)) up = true;
                    var cl = Get(s, "companies") as System.Collections.ArrayList;
                    if (cl != null) foreach (Dictionary<string, object> c in cl) cos.Add(Convert.ToString(Get(c, "name")));
                }
                if (up) list.Add(new Check("Tally", "ok", "Answering" + (cos.Count > 0 ? "; open: " + string.Join(", ", cos) : "") + "."));
                else if (tallyProc) list.Add(new Check("Tally", "bad", "TallyPrime is open but does not answer the bridge.", "In TallyPrime: F1 (Help) > Settings > Connectivity > Client/Server configuration: set \"TallyPrime acts as\" to Both, Enable ODBC to Yes, and the port (usually 9000). Then restart TallyPrime."));
                else list.Add(new Check("Tally", "warn", "TallyPrime is not open.", "Open TallyPrime and the company. The bridge carries on by itself."));
                if (up && cos.Count == 0) list.Add(new Check("Company", "warn", "No company is open in Tally.", "Open the company in TallyPrime."));
            }
            // the copy in the cloud and the load on Tally
            if (v != null)
            {
                try
                {
                    var k = Bridge.Call("/keep", null, 10000);
                    var cloud = Get(k, "cloud") as Dictionary<string, object>;
                    var cs = cloud != null ? Get(cloud, "status") as Dictionary<string, object> : null;
                    if (cloud == null || !Convert.ToBoolean(Get(cloud, "connected") ?? false))
                        list.Add(new Check("FinCom cloud", "warn", "This computer is not sending the books to FinCom's cloud.", "In FinCom: Settings > Books in the cloud > Connect this computer."));
                    else if (cs != null && !string.IsNullOrEmpty(Convert.ToString(Get(cs, "error"))))
                        list.Add(new Check("FinCom cloud", "warn", "Last try: " + Get(cs, "error"), "Nothing is lost: waiting days are sent when the internet or FinCom's cloud is back."));
                    else list.Add(new Check("FinCom cloud", "ok", "Connected" + (cs != null ? "; last sent " + (Get(cs, "lastSent") ?? "not yet") + ", waiting to send: " + (Get(cs, "waiting") ?? 0) + " day(s)" : "") + "."));
                    var load = Get(k, "load") as Dictionary<string, object>;
                    var ports = load != null ? Get(load, "ports") as System.Collections.ArrayList : null;
                    if (ports != null) foreach (Dictionary<string, object> p in ports)
                        list.Add(new Check("Load on Tally", "ok", "Port " + Get(p, "port") + ": the bridge used " + Get(p, "sharePct") + "% of Tally's time in the last minute (its limit is " + Get(p, "limitPct") + "%)."));
                }
                catch { }
            }
            // disk space
            try
            {
                var root = Path.GetPathRoot(Path.GetFullPath(App.Home));
                var d = new DriveInfo(root);
                var gb = d.AvailableFreeSpace / (1024.0 * 1024 * 1024);
                if (gb < 1) list.Add(new Check("Disk", "bad", "Only " + gb.ToString("0.0") + " GB free on " + root + ".", "Free some space: the copies of the books need room to grow."));
                else if (gb < 3) list.Add(new Check("Disk", "warn", gb.ToString("0.0") + " GB free on " + root + "."));
                else list.Add(new Check("Disk", "ok", gb.ToString("0") + " GB free."));
            }
            catch { }
            // internet
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(App.OpenUrl); req.Method = "HEAD"; req.Timeout = 8000;
                using (req.GetResponse()) { }
                list.Add(new Check("Internet", "ok", "FinCom can be reached."));
            }
            catch (WebException e) when (e.Response != null) { list.Add(new Check("Internet", "ok", "FinCom can be reached.")); }
            catch (Exception e) { list.Add(new Check("Internet", "warn", "FinCom cannot be reached: " + e.Message, "Check the internet connection or the office proxy. The bridge keeps working with Tally; the cloud copy waits.")); }
            return list;
        }
    }

    // ---------------------------------------------------------------- the companies kept in step, from the engine's folder
    public class CompanyRow { public string Name, Phase, UpTo, Seen, NotRead, Waiting, Trouble; }
    public static class Companies
    {
        public static List<CompanyRow> List()
        {
            var rows = new List<CompanyRow>();
            try
            {
                if (!Directory.Exists(App.SyncDir)) return rows;
                foreach (var d in Directory.GetDirectories(App.SyncDir))
                {
                    var m = App.ReadJson(Path.Combine(d, "manifest.json"));
                    if (m.Count == 0) continue;
                    object v;
                    var r = new CompanyRow { Name = m.TryGetValue("company", out v) ? Convert.ToString(v) : Path.GetFileName(d) };
                    var ph = m.TryGetValue("phase", out v) ? Convert.ToString(v) : "";
                    r.Phase = ph == "live" ? "In step" : ph == "first" ? "First copy" : ph == "open" ? "Reading opening balances" : ph == "check" ? "Checking" : ph;
                    r.UpTo = m.TryGetValue("doneTo", out v) ? Convert.ToString(v) : "";
                    r.Seen = m.TryGetValue("seen", out v) ? Convert.ToString(v).Replace("T", " ") : "";
                    var sk = m.TryGetValue("skipped", out v) ? v as System.Collections.ArrayList : null;
                    r.NotRead = sk != null && sk.Count > 0 ? sk.Count + " day(s)" : "";
                    var tr = m.TryGetValue("trouble", out v) ? v as Dictionary<string, object> : null;
                    r.Trouble = tr != null && tr.ContainsKey("why") ? Convert.ToString(tr["why"]) : "";
                    var q = Path.Combine(d, "cloud-out.txt");
                    r.Waiting = File.Exists(q) ? File.ReadAllLines(q).Where(x => x.Trim().Length == 8).Distinct().Count().ToString() : "0";
                    rows.Add(r);
                }
            }
            catch (Exception e) { App.Log("Companies: " + e.Message); }
            return rows;
        }
    }

    // ---------------------------------------------------------------- updates, checked by SHA-256, with a way back
    public static class Updater
    {
        public static string LastResult = "";
        // FinCom's update-signing key (the public half; the private half never leaves FinCom). The list of updates
        // (latest.json) must carry FinCom's signature (latest.json.sig), so a changed list, even on FinCom's own site,
        // is refused; the list in turn fixes each file's SHA-256.
        const string PublicKeyXml = "<RSAKeyValue><Modulus>1rseJE/fmVCEIZPmyUAV+nPrRk6zP5TwYfRRdtpVV8yWUJUADJBBkxqlQXdSI1ZxuZ8CAhhxYbpRcKx3Yiz+ugUDTjpYiWPrQCBRwcZjENOzYAwO72ziWfC3os8huXVpSK1XIOZhPkejyldjWAtdWU+mOfTVsdUGoC31086OYJU/FD7HfgJeiRLKsi7MTG8q/QzKcIvtqA8cYJk+0pSv4zDpo4nLg21OkcTVJPYxXH/aZSk4vSwk+VGnYJo1kmZy2MsLehXD50KA5DIqFPJ9MDuGB10PCfJLe8PVNzGpzAmOyzZPT5VaVVq4ilM2ijnG2qCt+rVzoCao0WxOcp3pbZrhxYofnpDvs+h0sq29Fqwj68R02OOVpIW0U2ssLA8Xe2RkplVNyGbs75Gi1Yt1r418XvQH++PAQSNrUgdzWNlwOSWZFxB+u+SPeVeJ2/jbPWy4E4xNOi/5fJebJ7rH5Mm1nHVx5yYMDa4/HsEudg1Q+1u39kwlmQ5nNMJaaGUh</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
        static string KeyXml()
        {
            var t = Environment.GetEnvironmentVariable("FINCOM_TEST_PUBKEY");
            return Environment.GetEnvironmentVariable("FINCOM_TEST") == "1" && !string.IsNullOrEmpty(t) ? File.ReadAllText(t) : PublicKeyXml;
        }
        public static bool Verify(byte[] data, byte[] sig)
        {
            try
            {
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(KeyXml());
                    return rsa.VerifyData(data, CryptoConfig.MapNameToOID("SHA256"), sig);
                }
            }
            catch { return false; }
        }
        public static Dictionary<string, object> Manifest()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var url = App.UpdateUrl;
            byte[] body, sig;
            using (var wc = new WebClient())
            {
                wc.Headers.Add("Cache-Control", "no-cache");
                var t = "?t=" + DateTime.UtcNow.Ticks;
                body = wc.DownloadData(url + t);
                try { sig = Convert.FromBase64String(Encoding.ASCII.GetString(wc.DownloadData(url + ".sig" + t)).Trim()); } catch { sig = new byte[0]; }
            }
            if (!Verify(body, sig)) throw new Exception("The list of updates is not signed by FinCom, so nothing was changed.");
            return App.Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body).TrimStart('\uFEFF'));
        }
        static byte[] Fetch(Dictionary<string, object> part, string what)
        {
            var url = Convert.ToString(part["url"]); var sha = Convert.ToString(part["sha256"]).ToLowerInvariant();
            if (!App.AllowedUrl(url)) throw new Exception(what + ": not one of FinCom's addresses (" + url + ")");
            byte[] b; using (var wc = new WebClient()) b = wc.DownloadData(url);
            var got = App.Sha256(b);
            if (got != sha) throw new Exception(what + " did not match its fingerprint (SHA-256 " + got.Substring(0, 12) + "\u2026, expected " + sha.Substring(0, Math.Min(12, sha.Length)) + "\u2026); not used.");
            return b;
        }
        // the engine: stop, swap, start, and go back if the new one does not answer with its own version
        public static string UpdateEngine(Dictionary<string, object> man, bool force = false)
        {
            if (!man.ContainsKey("engine")) return "No engine in the update.";
            var part = (Dictionary<string, object>)man["engine"];
            var want = Convert.ToString(part["version"]);
            var have = Supervisor.Current.EngineVersion;
            if (string.IsNullOrEmpty(have) && File.Exists(App.Engine)) have = App.EngineVersionOf(File.ReadAllText(App.Engine));
            if (!force && App.CompareVersions(want, have) <= 0) return "The bridge is up to date (" + have + ").";
            var bytes = Fetch(part, "The new bridge");
            var prevDir = Path.Combine(App.Home, "previous"); Directory.CreateDirectory(prevDir);
            var prev = Path.Combine(prevDir, "TDSBridge.ps1");
            if (File.Exists(App.Engine)) File.Copy(App.Engine, prev, true);
            var sup = Supervisor.Current;
            sup.Paused = true; sup.KillEngine("updating to " + want);
            try { if (Bridge.Ping() != null) Bridge.Call("/shutdown", "{}", 3000); } catch { }
            Thread.Sleep(1500);
            File.WriteAllBytes(App.Engine, bytes);
            sup.Paused = false; sup.StartEngine();
            int waitSec; if (!int.TryParse(Environment.GetEnvironmentVariable("FINCOM_UPDATE_WAIT") ?? "", out waitSec)) waitSec = 90;
            if (sup.WaitFor(v => v == want, waitSec)) { App.Log("Bridge updated to " + want); return LastResult = "The bridge was updated to " + want + "."; }
            App.Log("The new bridge " + want + " did not start; going back to " + have);
            sup.KillEngine("going back");
            if (File.Exists(prev)) File.Copy(prev, App.Engine, true);
            sup.StartEngine(); sup.WaitFor(v => true, 60);
            return LastResult = "The new bridge " + want + " did not start, so the previous one (" + have + ") is back. FinCom support has been told in the log.";
        }
        // the Connector itself: the new program is checked, then started from the update folder to swap itself in once
        // this one has closed; it puts the old one back if the new one does not start
        public static string UpdateSelf(Dictionary<string, object> man, Action exitApp)
        {
            if (!man.ContainsKey("connector")) return "";
            var part = (Dictionary<string, object>)man["connector"];
            var want = Convert.ToString(part["version"]);
            if (App.CompareVersions(want, App.Version) <= 0) return "";
            if (!App.IsWindows) return "The Connector " + want + " is available.";
            var bytes = Fetch(part, "The new Connector");
            var upd = Path.Combine(App.Home, "update"); Directory.CreateDirectory(upd);
            var neu = Path.Combine(upd, "FinComConnector.new.exe"); File.WriteAllBytes(neu, bytes);
            var prevDir = Path.Combine(App.Home, "previous"); Directory.CreateDirectory(prevDir);
            var ok = Path.Combine(upd, "started.ok"); if (File.Exists(ok)) File.Delete(ok);
            App.Log("Updating the Connector to " + want);
            Process.Start(new ProcessStartInfo(neu, "--swap " + Process.GetCurrentProcess().Id) { UseShellExecute = false });
            exitApp();
            return "Updating to " + want + "\u2026";
        }
        public static string CheckAndApply(bool auto, Action exitApp)
        {
            try
            {
                var man = Manifest();
                var r = UpdateEngine(man);
                var s = UpdateSelf(man, exitApp);
                return (r + " " + s).Trim();
            }
            catch (Exception e) { App.Log("Update: " + e.Message); return LastResult = "Could not update: " + e.Message; }
        }
    }

    public static class Swap
    {
        public static int Run(string[] args)
        {
            int pid; int.TryParse(args.Length > 1 ? args[1] : "0", out pid);
            try { if (pid > 0) Process.GetProcessById(pid).WaitForExit(30000); } catch { }
            Thread.Sleep(1000);
            var me = System.Reflection.Assembly.GetExecutingAssembly().Location;
            var prevDir = Path.Combine(App.Home, "previous"); Directory.CreateDirectory(prevDir);
            var prev = Path.Combine(prevDir, "FinComConnector.exe");
            var ok = Path.Combine(App.Home, "update", "started.ok");
            try
            {
                if (File.Exists(App.Exe)) File.Copy(App.Exe, prev, true);
                File.Copy(me, App.Exe, true);
                Process.Start(new ProcessStartInfo(App.Exe, "--tray --updated") { UseShellExecute = false });
                for (int i = 0; i < 60; i++) { if (File.Exists(ok)) { App.Log("The Connector was updated to " + App.Version); return 0; } Thread.Sleep(1000); }
                App.Log("The new Connector did not start; going back to the previous one");
            }
            catch (Exception e) { App.Log("Could not swap in the new Connector: " + e.Message); }
            try
            {
                foreach (var p in Process.GetProcessesByName("FinComConnector")) { try { if (p.Id != Process.GetCurrentProcess().Id) { p.Kill(); p.WaitForExit(5000); } } catch { } }
                if (File.Exists(prev)) File.Copy(prev, App.Exe, true);
                Process.Start(new ProcessStartInfo(App.Exe, "--tray --rolledback") { UseShellExecute = false });
            }
            catch (Exception e) { App.Log("Could not go back to the previous Connector: " + e.Message); }
            return 1;
        }
    }

    // ---------------------------------------------------------------- one click: the log and details to FinCom support
    public static class Support
    {
        static string CloudKey()
        {
            var c = App.Config(); object v;
            var s = c.TryGetValue("CloudKey", out v) ? Convert.ToString(v) : "";
            if (s.StartsWith("plain:")) return s.Substring(6);
            if (s.StartsWith("dpapi:"))
            {
                try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Substring(6)), null, DataProtectionScope.CurrentUser)); } catch { return ""; }
            }
            return s;
        }
        public static byte[] Pack(string note)
        {
            using (var ms = new MemoryStream())
            {
                using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
                {
                    Action<string, string> add = (name, text) => { var e = z.CreateEntry(name); using (var w = new StreamWriter(e.Open(), new UTF8Encoding(false))) w.Write(text ?? ""); };
                    add("note.txt", note);
                    add("tds-bridge.log", App.Tail(App.BridgeLog, 3 * 1024 * 1024));
                    add("connector.log", App.Tail(App.OwnLog, 1024 * 1024));
                    // the settings, without any key
                    var cfg = App.Config(); foreach (var k in new[] { "Key", "CloudKey" }) if (cfg.ContainsKey(k)) cfg[k] = "(hidden)";
                    add("settings.json", App.Json.Serialize(cfg));
                    var info = new StringBuilder();
                    info.AppendLine("Connector " + App.Version + ", bridge " + Supervisor.Current.EngineVersion + " (" + Supervisor.Current.State + ", restarts " + Supervisor.Current.Restarts + ")");
                    info.AppendLine("Windows " + Environment.OSVersion + ", " + (Environment.Is64BitOperatingSystem ? "64-bit" : "32-bit") + ", .NET " + Environment.Version + ", computer " + Environment.MachineName + ", user " + Environment.UserName);
                    try { foreach (var c in Doctor.Run()) info.AppendLine("[" + c.Level + "] " + c.Name + ": " + c.Say + (c.Fix != "" ? "  -> " + c.Fix : "")); } catch { }
                    add("computer.txt", info.ToString());
                    try
                    {
                        if (Directory.Exists(App.SyncDir))
                        {
                            foreach (var f in new[] { "keep-load.json", "cloud-status.json" }) { var p = Path.Combine(App.SyncDir, f); if (File.Exists(p)) add("sync/" + f, File.ReadAllText(p)); }
                            foreach (var d in Directory.GetDirectories(App.SyncDir))
                                foreach (var f in new[] { "manifest.json", "keep.json" }) { var p = Path.Combine(d, f); if (File.Exists(p)) add("sync/" + Path.GetFileName(d) + "/" + f, File.ReadAllText(p)); }
                        }
                    }
                    catch { }
                }
                return ms.ToArray();
            }
        }
        // to FinCom when this computer is connected; otherwise saved on the Desktop to attach in FinCom's Help
        public static string Send(string note)
        {
            var zip = Pack(note);
            var c = App.Config(); object u;
            var url = c.TryGetValue("CloudUrl", out u) ? Convert.ToString(u) : "";
            var key = CloudKey();
            if (url != "" && key != "")
            {
                try
                {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    var body = App.Json.Serialize(new Dictionary<string, object> { { "kind", "support" }, { "note", note }, { "zip", Convert.ToBase64String(zip) }, { "version", App.Version } });
                    var req = (HttpWebRequest)WebRequest.Create(url); req.Method = "POST"; req.ContentType = "application/json"; req.Timeout = 60000;
                    req.Headers.Add("x-fincom-device", key);
                    var b = Encoding.UTF8.GetBytes(body); req.ContentLength = b.Length;
                    using (var s = req.GetRequestStream()) s.Write(b, 0, b.Length);
                    using (var r = (HttpWebResponse)req.GetResponse()) { }
                    App.Log("Sent the log and details to FinCom support");
                    return "Sent to FinCom support. Mention the time (" + DateTime.Now.ToString("dd MMM HH:mm") + ") if you write to them.";
                }
                catch (Exception e) { App.Log("Could not send to support: " + e.Message); }
            }
            var desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (string.IsNullOrEmpty(desk) || !Directory.Exists(desk)) desk = App.Home;
            var file = Path.Combine(desk, "FinCom-support-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".zip");
            File.WriteAllBytes(file, zip);
            return "Saved as " + file + ". Attach it to a ticket in FinCom (Help) or email it to FinCom support.";
        }
    }

    // ---------------------------------------------------------------- putting it on the computer
    public static class Installer
    {
        public static bool InPlace()
        {
            try { return string.Equals(Path.GetFullPath(System.Reflection.Assembly.GetExecutingAssembly().Location), Path.GetFullPath(App.Exe), StringComparison.OrdinalIgnoreCase); } catch { return false; }
        }
        public static string EmbeddedEngine()
        {
            using (var s = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("engine.ps1"))
            {
                if (s == null) return null;
                using (var r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }
        static void Run(string exe, string args)
        {
            try { var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true }); p.WaitForExit(20000); } catch { }
        }
        public static string Install()
        {
            Directory.CreateDirectory(App.Home);
            var me = System.Reflection.Assembly.GetExecutingAssembly().Location;
            // the engine: the one inside this program, unless the one here is newer
            var emb = EmbeddedEngine();
            var have = File.Exists(App.Engine) ? App.EngineVersionOf(File.ReadAllText(App.Engine)) : "";
            if (emb != null && App.CompareVersions(App.EngineVersionOf(emb), have) > 0)
            {
                if (File.Exists(App.Engine)) { var pd = Path.Combine(App.Home, "previous"); Directory.CreateDirectory(pd); File.Copy(App.Engine, Path.Combine(pd, "TDSBridge.ps1"), true); }
                File.WriteAllText(App.Engine, emb, new UTF8Encoding(true));
            }
            if (App.IsWindows)
            {
                // the old setup's starter keeps restarting the bridge on its own: it is set aside (kept, not deleted)
                var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                var old = Path.Combine(startup, "TDS Desk Tally Bridge.vbs");
                if (File.Exists(old)) { var keep = Path.Combine(App.Home, "old-startup-starter.vbs.off"); if (File.Exists(keep)) File.Delete(keep); File.Move(old, keep); }
                Run(App.PowerShell, "-NoProfile -ExecutionPolicy Bypass -Command \"Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*run-hidden.vbs*') -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*TDSBridge.ps1*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"");
                foreach (var p in Process.GetProcessesByName("FinComConnector")) { if (p.Id != Process.GetCurrentProcess().Id) try { p.Kill(); p.WaitForExit(5000); } catch { } }
            }
            if (!InPlace()) File.Copy(me, App.Exe, true);
            if (App.IsWindows)
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) k.SetValue(App.Name, "\"" + App.Exe + "\" --tray");
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComConnector"))
                {
                    k.SetValue("DisplayName", App.Name); k.SetValue("DisplayVersion", App.Version); k.SetValue("Publisher", "Yuvnav Services Private Limited");
                    k.SetValue("UninstallString", "\"" + App.Exe + "\" --remove"); k.SetValue("DisplayIcon", App.Exe); k.SetValue("NoModify", 1); k.SetValue("NoRepair", 1);
                    k.SetValue("InstallLocation", App.Home);
                }
                // a Start menu entry
                var sm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), App.Name + ".lnk");
                Run(App.PowerShell, "-NoProfile -ExecutionPolicy Bypass -Command \"$s = (New-Object -ComObject WScript.Shell).CreateShortcut('" + sm.Replace("'", "''") + "'); $s.TargetPath = '" + App.Exe.Replace("'", "''") + "'; $s.Save()\"");
            }
            App.Log("Installed " + App.Name + " " + App.Version + " in " + App.Home);
            return App.Exe;
        }
        public static void Remove()
        {
            if (!App.IsWindows) return;
            try { using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) k.DeleteValue(App.Name, false); } catch { }
            try { Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComConnector", false); } catch { }
            try { var sm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), App.Name + ".lnk"); if (File.Exists(sm)) File.Delete(sm); } catch { }
            Supervisor.Current.Stop();
            try { if (Bridge.Ping() != null) Bridge.Call("/shutdown", "{}", 3000); } catch { }
            App.Log("Removed from starting with Windows. The folder " + App.Home + " (settings and copies) is left as it is.");
        }
    }
}
