// FinComConnector.exe --selftest: the parts that need no screen, run against the real engine and a stand-in Tally
// (tests/run_connector.py starts those, and a small web server for updates, then runs this under Mono).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;

namespace FinCom.Connector
{
    static class SelfTest
    {
        static int fails;
        static void Ok(bool c, string w) { Console.WriteLine((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; }
        static string Arg(string[] a, string k) { var i = Array.IndexOf(a, k); return i >= 0 && i + 1 < a.Length ? a[i + 1] : ""; }
        public static int Run(string[] args)
        {
            try { Steps(args); } catch (Exception e) { Ok(false, "stopped: " + e); }
            Supervisor.Current.Stop();
            Console.WriteLine(fails == 0 ? "all passed" : fails + " FAILED");
            return fails == 0 ? 0 : 1;
        }
        static void Steps(string[] args)
        {
            var upd = Arg(args, "--updates");            // a folder served on http://127.0.0.1:8150/
            // ---- install: the engine from inside the program goes into the folder
            Installer.Install();
            Ok(File.Exists(App.Engine) && App.EngineVersionOf(File.ReadAllText(App.Engine)) != "", "installed: the bridge " + App.EngineVersionOf(File.ReadAllText(App.Engine)) + " is in " + App.Home);
            // ---- the minder starts it, and starts it again when it stops
            var sup = Supervisor.Current; sup.IntervalSec = 2; sup.Start();
            Ok(sup.WaitFor(v => true, 90), "the minder starts the bridge and it answers (" + sup.EngineVersion + ")");
            var v0 = Bridge.Ping();
            sup.SimulateCrash();
            var t0 = DateTime.Now;
            while (Bridge.Ping() != null && (DateTime.Now - t0).TotalSeconds < 20) Thread.Sleep(500);
            Ok(Bridge.Ping() == null, "the bridge is stopped (as if it had crashed)");
            Ok(sup.WaitFor(v => true, 120) && sup.Restarts >= 1, "when the bridge is stopped, the minder starts it again (restarts: " + sup.Restarts + ")");
            // ---- the checks
            var checks = Doctor.Run();
            foreach (var c in checks) Console.WriteLine("        [" + c.Level + "] " + c.Name + ": " + c.Say);
            Ok(checks.Any(c => c.Name == "Tally Bridge" && c.Level == "ok"), "the check says the bridge is running");
            Ok(checks.Any(c => c.Name == "Tally" && c.Level == "ok"), "the check says Tally answers, and which company is open");
            Ok(checks.Any(c => c.Name == "Disk"), "the check looks at disk space");
            // ---- support: the log and details, no keys
            var zip = Support.Pack("test note");
            using (var z = new ZipArchive(new MemoryStream(zip)))
            {
                var names = z.Entries.Select(e => e.FullName).ToList();
                Ok(names.Contains("tds-bridge.log") && names.Contains("computer.txt") && names.Contains("settings.json"), "the support pack has the log, the computer's details and the settings: " + string.Join(", ", names.Take(8)));
                var s = new StreamReader(z.GetEntry("settings.json").Open()).ReadToEnd();
                Ok(s.Contains("(hidden)") && !s.Contains(Bridge.Key), "keys are hidden in the support pack");
            }
            if (upd == "") return;
            // ---- updates: a newer engine, checked by its fingerprint
            Environment.SetEnvironmentVariable("FINCOM_TEST", "1");
            var p0 = App.Prefs(); p0["updateUrl"] = "http://127.0.0.1:8150/latest.json"; App.SavePrefs(p0);
            Func<string, string, string, string> manifest = (ver, file, sha) => App.Json.Serialize(new Dictionary<string, object> { { "engine", new Dictionary<string, object> { { "version", ver }, { "url", "http://127.0.0.1:8150/" + file }, { "sha256", sha } } } });
            // the list signed as FinCom signs it (here with a test key; the Connector is told the test key's public half)
            Action<string, bool> publish = (json, sign) =>
            {
                var b = Encoding.UTF8.GetBytes(json);
                File.WriteAllBytes(Path.Combine(upd, "latest.json"), b);
                byte[] sig = new byte[256];
                if (sign) using (var rsa = new System.Security.Cryptography.RSACryptoServiceProvider()) { rsa.PersistKeyInCsp = false; rsa.FromXmlString(File.ReadAllText(Environment.GetEnvironmentVariable("FINCOM_TEST_SIGNKEY"))); sig = rsa.SignData(b, System.Security.Cryptography.CryptoConfig.MapNameToOID("SHA256")); }
                File.WriteAllText(Path.Combine(upd, "latest.json.sig"), Convert.ToBase64String(sig));
            };
            var cur = File.ReadAllText(App.Engine);
            var next = cur.Replace("$BridgeVersion = '" + v0 + "'", "$BridgeVersion = '9.9.1'");
            File.WriteAllText(Path.Combine(upd, "good.ps1"), next, new UTF8Encoding(true));
            var good = App.Sha256(File.ReadAllBytes(Path.Combine(upd, "good.ps1")));
            // a list not signed by FinCom: nothing happens
            publish(manifest("9.9.1", "good.ps1", good), false);
            string r0 = "";
            try { r0 = Updater.UpdateEngine(Updater.Manifest()); } catch (Exception e) { r0 = e.Message; }
            Ok(r0.Contains("not signed") && Bridge.Ping() == v0, "a list of updates not signed by FinCom is refused: " + r0);
            publish(manifest("9.9.1", "good.ps1", new string('0', 64)), true);
            string r1 = "";
            try { r1 = Updater.UpdateEngine(Updater.Manifest()); } catch (Exception e) { r1 = e.Message; }
            Ok(r1.Contains("fingerprint") && Bridge.Ping() == v0, "a file that does not match its fingerprint is refused, and the bridge stays as it was: " + r1);
            publish(manifest("9.9.1", "good.ps1", good), true);
            var r2 = Updater.UpdateEngine(Updater.Manifest());
            Ok(Bridge.Ping() == "9.9.1" && File.Exists(Path.Combine(App.Home, "previous", "TDSBridge.ps1")), "a newer bridge with the right fingerprint goes in and answers: " + r2);
            // ---- a new bridge that does not start: back to the one before
            var broken = "exit 3\r\n" + next.Replace("$BridgeVersion = '9.9.1'", "$BridgeVersion = '9.9.2'");
            File.WriteAllText(Path.Combine(upd, "broken.ps1"), broken, new UTF8Encoding(true));
            publish(manifest("9.9.2", "broken.ps1", App.Sha256(File.ReadAllBytes(Path.Combine(upd, "broken.ps1")))), true);
            var r3 = Updater.UpdateEngine(Updater.Manifest());
            Ok(Bridge.Ping() == "9.9.1" && r3.Contains("previous"), "a new bridge that does not start is taken back out, and the previous one runs again: " + r3);
            Ok(File.ReadAllText(App.OwnLog).Contains("going back"), "the Connector's own log says so");
            // an address outside FinCom's sites in the settings is not used
            var p1 = App.Prefs(); p1["updateUrl"] = "https://evil.example.com/latest.json"; App.SavePrefs(p1);
            Ok(App.UpdateUrl == App.DefaultUpdateUrl, "an update address that is not FinCom's is ignored");
        }
        static string CommandLine(Process p) { try { return File.ReadAllText("/proc/" + p.Id + "/cmdline").Replace('\0', ' '); } catch { return ""; } }
    }
}
