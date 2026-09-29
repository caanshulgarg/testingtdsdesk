// FinCom Connector: the window, the tray icon, and how the program starts.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace FinCom.Connector
{
    static class Program
    {
        static Mutex single;
        [STAThread]
        static int Main(string[] args)
        {
            var a = new HashSet<string>(args.Select(x => x.ToLowerInvariant()));
            if (a.Contains("--selftest")) return SelfTest.Run(args);
            if (a.Contains("--verify") && args.Length >= 3) { var ok = Updater.Verify(File.ReadAllBytes(args[1]), Convert.FromBase64String(File.ReadAllText(args[2]).Trim())); Console.WriteLine(ok ? "signature ok" : "signature BAD"); return ok ? 0 : 1; }
            if (a.Contains("--remove")) { Installer.Remove(); if (!a.Contains("--quiet")) MessageBox.Show("FinCom Connector will not start with Windows any more.\n\nThe folder " + App.Home + " (settings and the copies of the books) is left as it is.", App.Name); return 0; }
            bool first = true;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            // a downloaded Connector installs even while the installed one runs (the installer stops that one)
            if (!Installer.InPlace() && !a.Contains("--here"))
            {
                var r = MessageBox.Show("Install FinCom Connector " + App.Version + " on this computer?\n\nA Connector already installed here is replaced by this one.\n\n" +
                    "It keeps FinCom's Tally Bridge running, starts with Windows, shows what the bridge is doing and updates it.\n\n" +
                    "It goes into " + App.Home + " for this Windows user. No admin rights are needed. An older bridge set up here is taken over, with its settings.",
                    App.Name, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (r != DialogResult.OK) return 0;
                try { Installer.Install(); }
                catch (Exception e) { MessageBox.Show("Could not install: " + e.Message + "\n\nSend this message to FinCom support.", App.Name, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
                Process.Start(new ProcessStartInfo(App.Exe, "--installed") { UseShellExecute = false });
                return 0;
            }
            single = new Mutex(true, "Local\\FinComConnector", out first);
            if (!first)
            {
                // already running: ask it to show its window
                try { using (var ev = EventWaitHandle.OpenExisting("Local\\FinComConnectorShow")) ev.Set(); } catch { }
                return 0;
            }
            new Thread(Installer.EnsureShortcuts) { IsBackground = true }.Start();
            Supervisor.Current.Start();
            var form = new MainForm(!a.Contains("--tray"));
            Application.Run(form);
            Supervisor.Current.Stop();
            return 0;
        }
    }

    class MainForm : Form
    {
        readonly NotifyIcon tray = new NotifyIcon();
        readonly TabControl tabs = new TabControl { Dock = DockStyle.Fill };
        // the top of the window: one line saying what is going on, one saying what to do, and the three things people need
        readonly Label bigState = new Label { Dock = DockStyle.Top, Height = 44, Padding = new Padding(16, 12, 8, 0), Font = new Font("Segoe UI", 15f, FontStyle.Bold) };
        readonly Label todo = new Label { Dock = DockStyle.Top, Height = 52, Padding = new Padding(19, 4, 14, 4), Font = new Font("Segoe UI", 10.5f) };
        readonly Button more = new Button { Text = "Show details", Width = 140, Height = 42 };
        Button startStop;
        readonly ListView checks = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, HeaderStyle = ColumnHeaderStyle.Nonclickable, ShowItemToolTips = true };
        readonly ListView cos = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
        readonly TextBox logBox = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Font = new Font("Consolas", 9f) };
        readonly TextBox logFilter = new TextBox { Width = 220 };
        readonly CheckBox errorsOnly = new CheckBox { Text = "Only problems", AutoSize = true };
        readonly Label updInfo = new Label { Dock = DockStyle.Top, Height = 90, Padding = new Padding(10) };
        readonly CheckBox autoUpd = new CheckBox { Text = "Update by itself (when nothing is being posted to Tally)", AutoSize = true };
        readonly TextBox note = new TextBox { Multiline = true, Height = 90, Dock = DockStyle.Top };
        readonly Label supportInfo = new Label { Dock = DockStyle.Top, Height = 60, Padding = new Padding(6) };
        readonly Label pairInfo = new Label { AutoSize = true, Padding = new Padding(8, 8, 0, 0), Font = new Font("Segoe UI", 10f, FontStyle.Bold) };
        Button copyBtn; string codeNow = "";
        readonly CheckBox startWin = new CheckBox { Text = "Start with Windows (quietly, near the clock)", AutoSize = true };
        readonly CheckBox waitTally = new CheckBox { Text = "Wait for TallyPrime: start the bridge only once TallyPrime is open on this computer", AutoSize = true };
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 5000 };
        readonly bool showNow;
        bool quitting;
        EventWaitHandle showEvent;
        string lastLevel = "";
        DateTime lastUpdateCheck = DateTime.MinValue, badSince = DateTime.MinValue;

        public MainForm(bool show)
        {
            showNow = show;
            Text = App.Name; Width = 900; Height = 260; StartPosition = FormStartPosition.CenterScreen;
            Icon = MakeIcon(Color.FromArgb(22, 163, 74));
            Font = new Font("Segoe UI", 9.5f);

            // ---- Status
            var pStatus = new TabPage("Status");
            checks.Columns.Add("", 26); checks.Columns.Add("Check", 130); checks.Columns.Add("What is going on", 360); checks.Columns.Add("What to do", 340);
            var bar1 = Buttons("Check again", (EventHandler)((s, e) => RefreshAll(true)), "Restart the bridge", (EventHandler)((s, e) => { Supervisor.Current.Restart("restarted from the Connector"); RefreshAll(true); }),
                               "Open FinCom", (EventHandler)((s, e) => OpenUrl(App.OpenUrl)), "Open the folder", (EventHandler)((s, e) => OpenUrl(App.Home)));
            var bar2 = Buttons("Connect FinCom on this computer", (EventHandler)((s, e) => ConnectFinCom()), "Show connect code", (EventHandler)((s, e) => ShowCode()));
            var cp = new Button { Text = "Copy", AutoSize = true, Height = 30, Visible = false }; cp.Click += (s, e) => { try { Clipboard.SetText(codeNow); pairInfo.Text += "  (copied)"; } catch { } };
            copyBtn = cp; bar2.Controls.Add(pairInfo); bar2.Controls.Add(cp);
            pStatus.Controls.Add(checks); pStatus.Controls.Add(bar2); pStatus.Controls.Add(bar1);

            // ---- Companies
            var pCos = new TabPage("Companies");
            var heads = new[] { "Company in Tally", "State", "Copied up to", "Last checked", "Days not read", "Waiting to send", "Problem" }; var widths = new[] { 250, 120, 100, 140, 100, 110, 260 };
            for (int i = 0; i < heads.Length; i++) cos.Columns.Add(heads[i], widths[i]);
            pCos.Controls.Add(cos);

            // ---- Log
            var pLog = new TabPage("Log");
            var lb = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 38, Padding = new Padding(4) };
            lb.Controls.Add(new Label { Text = "Find:", AutoSize = true, Padding = new Padding(0, 6, 0, 0) }); lb.Controls.Add(logFilter); lb.Controls.Add(errorsOnly);
            var rl = new Button { Text = "Refresh", AutoSize = true }; rl.Click += (s, e) => ShowLog(); lb.Controls.Add(rl);
            logFilter.TextChanged += (s, e) => ShowLog(); errorsOnly.CheckedChanged += (s, e) => ShowLog();
            pLog.Controls.Add(logBox); pLog.Controls.Add(lb);

            // ---- Updates
            var pUpd = new TabPage("Updates");
            autoUpd.Checked = App.Pref("autoUpdate", "true") == "true";
            autoUpd.CheckedChanged += (s, e) => { var p = App.Prefs(); p["autoUpdate"] = autoUpd.Checked ? "true" : "false"; App.SavePrefs(p); };
            var ub = Buttons("Check for updates now", (EventHandler)((s, e) => DoUpdate(false)));
            var ap = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 100, Padding = new Padding(8, 4, 4, 4), FlowDirection = FlowDirection.TopDown }; ap.Controls.Add(autoUpd); ap.Controls.Add(startWin); ap.Controls.Add(waitTally);
            startWin.Checked = App.StartsWithWindows; waitTally.Checked = App.WaitForTally;
            startWin.CheckedChanged += (s, e) =>
            {
                if (!startWin.Checked && App.Pref("warnedStart", "") != "yes")
                {
                    MessageBox.Show("When FinCom Connector isn't running, the copy of the books in FinCom's cloud stops updating and FinCom cannot post to Tally.\n\nOpen FinCom Connector from the Start menu when you work.", App.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    var pp = App.Prefs(); pp["warnedStart"] = "yes"; App.SavePrefs(pp);
                }
                try { App.StartsWithWindows = startWin.Checked; } catch (Exception ex) { MessageBox.Show("Could not change it: " + ex.Message, App.Name); }
            };
            waitTally.CheckedChanged += (s, e) => { var pp = App.Prefs(); pp["waitForTally"] = waitTally.Checked ? "true" : "false"; App.SavePrefs(pp); App.Log(waitTally.Checked ? "Waits for TallyPrime before starting the bridge" : "Starts the bridge without waiting for TallyPrime"); };
            pUpd.Controls.Add(ap); pUpd.Controls.Add(ub); pUpd.Controls.Add(updInfo);

            // ---- Help
            var pHelp = new TabPage("Help");
            var hl = new Label { Dock = DockStyle.Top, Height = 44, Padding = new Padding(6), Text = "Something not right? Say what happened (optional) and press Send. The log and details of this computer go to FinCom support (no passwords or keys)." };
            var hb = Buttons("Send to FinCom support", (EventHandler)((s, e) => { supportInfo.Text = "Sending\u2026"; supportInfo.Refresh(); var t = note.Text; ThreadPool.QueueUserWorkItem(_ => { var r = Support.Send(t); BeginInvoke((Action)(() => { supportInfo.Text = r; })); }); }));
            pHelp.Controls.Add(supportInfo); pHelp.Controls.Add(hb); pHelp.Controls.Add(note); pHelp.Controls.Add(hl);

            tabs.TabPages.AddRange(new[] { pStatus, pCos, pLog, pUpd, pHelp });
            tabs.Visible = false;
            var top = new Panel { Dock = DockStyle.Top, Height = 160 };
            var row = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, Padding = new Padding(14, 6, 6, 6) };
            Func<string, EventHandler, Button> big = (t, h) => { var x = new Button { Text = t, Width = 170, Height = 42, Font = new Font("Segoe UI", 11f, FontStyle.Bold) }; x.Click += h; row.Controls.Add(x); return x; };
            startStop = big("\u25A0  Stop", (s, e) => StartStop());
            big("Open FinCom", (s, e) => OpenUrl(App.OpenUrl));
            big("Exit", (s, e) => ExitAsked());
            more.Click += (s, e) => { tabs.Visible = !tabs.Visible; more.Text = tabs.Visible ? "Hide details" : "Show details"; Height = tabs.Visible ? 640 : 260; if (tabs.Visible) RefreshAll(true); };
            row.Controls.Add(more);
            top.Controls.Add(row); top.Controls.Add(todo); top.Controls.Add(bigState);
            Controls.Add(tabs); Controls.Add(top);

            // ---- tray
            tray.Icon = Icon; tray.Text = App.Name; tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open FinCom Connector", null, (s, e) => ShowMe());
            var ss = menu.Items.Add("Stop", null, (s, e) => StartStop());
            menu.Items.Add("Open FinCom", null, (s, e) => OpenUrl(App.OpenUrl));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, (s, e) => ExitAsked());
            menu.Opening += (s, e) => { ss.Text = Supervisor.Current.StoppedByYou ? "Start" : "Stop"; };
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowMe();

            FormClosing += (s, e) => { if (!quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); tray.ShowBalloonTip(3000, App.Name, Supervisor.Current.StoppedByYou ? "Stopped. Right-click this icon to start it again or exit." : "Still running near the clock, so FinCom can reach Tally. Right-click this icon to stop it or exit.", ToolTipIcon.Info); } };
            FormClosed += (s, e) => { tray.Visible = false; };
            timer.Tick += (s, e) => Tick();
            try { showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\FinComConnectorShow"); ThreadPool.RegisterWaitForSingleObject(showEvent, (o, t) => BeginInvoke((Action)ShowMe), null, -1, false); } catch { }
            Load += (s, e) => { if (!showNow) { BeginInvoke((Action)Hide); } timer.Start(); RefreshAll(true); };
        }

        // buttons in a row: text, what it does, text, what it does, ...
        FlowLayoutPanel Buttons(params object[] bs)
        {
            var p = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(6, 4, 4, 4) };
            for (int i = 0; i + 1 < bs.Length; i += 2) { var x = new Button { Text = (string)bs[i], AutoSize = true, Height = 30 }; x.Click += (EventHandler)bs[i + 1]; p.Controls.Add(x); }
            return p;
        }
        // FinCom opens in the browser with a fresh one-time code in its address and connects by itself
        void ConnectFinCom()
        {
            try
            {
                if (Bridge.Ping() == null) { MessageBox.Show("The bridge is not running yet. Wait a moment (or open TallyPrime if the Connector waits for it), then try again.", App.Name); return; }
                var code = Bridge.NewPairCode();
                if (code.Length != 6) throw new Exception("the bridge gave no code");
                OpenUrl(App.OpenUrl.TrimEnd('/') + "/#pair=" + code);
                pairInfo.Text = "FinCom is opening in your browser and connects by itself.";
                copyBtn.Visible = false;
            }
            catch (Exception ex) { MessageBox.Show("Could not open a connect code: " + ex.Message + "\n\nThis needs Tally Bridge 1.13.0 or later.", App.Name); }
        }
        void ShowCode()
        {
            try { codeNow = Bridge.NewPairCode(); pairInfo.Text = "Connect code: " + codeNow + "  (for 10 minutes)"; copyBtn.Visible = true; }
            catch (Exception ex) { pairInfo.Text = "Could not open a connect code: " + ex.Message; }
        }
        // Stop: the bridge and the copier stop, Tally is not asked anything, until Start. Start: back on
        void StartStop()
        {
            var sup = Supervisor.Current; var stop = !sup.StoppedByYou;
            startStop.Enabled = false; bigState.Text = stop ? "\u2026  Stopping" : "\u2026  Starting"; bigState.ForeColor = Color.DimGray;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try { if (stop) sup.StopByYou(); else sup.StartByYou(); } catch (Exception ex) { App.Log("Start/stop: " + ex.Message); }
                try { BeginInvoke((Action)(() => { startStop.Enabled = true; RefreshAll(true); })); } catch { }
            });
        }
        // Exit: everything stops and the Connector closes (the desktop icon opens it again)
        void ExitAsked()
        {
            var r = MessageBox.Show("Exit FinCom Connector?\n\nThe bridge stops: FinCom cannot reach Tally and the copy of the books is not kept up to date until you open FinCom Connector again (the icon on the desktop).",
                App.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return;
            quitting = true;
            try { Supervisor.Current.Stop(); if (Bridge.Ping() != null) Bridge.Call("/shutdown", "{}", 3000); } catch { }
            Close();
        }
        void ShowMe() { Show(); WindowState = FormWindowState.Normal; Activate(); RefreshAll(true); }
        static void OpenUrl(string u) { try { Process.Start(new ProcessStartInfo(u) { UseShellExecute = true }); } catch { } }

        int ticks;
        void Tick()
        {
            ticks++;
            if (Visible) RefreshAll(ticks % 6 == 0);     // the full check every half minute while the window is open
            else if (ticks % 6 == 0) RefreshAll(true);
            // updates: every six hours, by themselves, when nothing is being posted
            if (autoUpd.Checked && (DateTime.Now - lastUpdateCheck).TotalHours >= 6) DoUpdate(true);
        }

        volatile bool busy;
        void RefreshAll(bool full)
        {
            if (busy) return;
            busy = true;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                List<Check> list = null; List<CompanyRow> rows = null;
                try { if (full) list = Doctor.Run(); rows = Companies.List(); } catch { }
                try { BeginInvoke((Action)(() => { Show(list, rows); busy = false; })); } catch { busy = false; }
            });
        }
        void Show(List<Check> list, List<CompanyRow> rows)
        {
            var sup = Supervisor.Current;
            if (list != null)
            {
                checks.BeginUpdate(); checks.Items.Clear();
                foreach (var c in list)
                {
                    var it = new ListViewItem(c.Level == "ok" ? "✔" : c.Level == "warn" ? "!" : "✖");
                    it.SubItems.Add(c.Name); it.SubItems.Add(c.Say); it.SubItems.Add(c.Fix);
                    it.ToolTipText = c.Say + (c.Fix != "" ? "\n\n" + c.Fix : "");
                    it.ForeColor = c.Level == "ok" ? Color.FromArgb(21, 128, 61) : c.Level == "warn" ? Color.FromArgb(180, 83, 9) : Color.FromArgb(185, 28, 28);
                    checks.Items.Add(it);
                }
                checks.EndUpdate();
                var worst = sup.StoppedByYou ? "stopped" : list.Any(c => c.Level == "bad") ? "bad" : list.Any(c => c.Level == "warn") ? "warn" : "ok";
                var color = worst == "ok" ? Color.FromArgb(22, 163, 74) : worst == "warn" ? Color.FromArgb(217, 119, 6) : worst == "stopped" ? Color.Gray : Color.FromArgb(220, 38, 38);
                if (worst != lastLevel) { tray.Icon = MakeIcon(color); tray.Text = App.Name + (worst == "ok" ? ": working" : worst == "warn" ? ": working, one thing to look at" : worst == "stopped" ? ": stopped" : ": not working"); }
                // a problem that lasts two minutes is worth a word in the corner of the screen
                if (worst == "bad") { if (badSince == DateTime.MinValue) badSince = DateTime.Now; else if ((DateTime.Now - badSince).TotalMinutes >= 2 && lastLevel == "bad" && !Visible) { var b = list.First(c => c.Level == "bad"); tray.ShowBalloonTip(8000, App.Name + ": " + b.Name, b.Say + " " + b.Fix, ToolTipIcon.Warning); badSince = DateTime.Now.AddMinutes(30); } }
                else badSince = DateTime.MinValue;
                lastLevel = worst;
            }
            ShowTop(list);
            if (rows != null)
            {
                cos.BeginUpdate(); cos.Items.Clear();
                foreach (var r in rows)
                {
                    var it = new ListViewItem(r.Name);
                    foreach (var v in new[] { r.Phase, Day(r.UpTo), r.Seen, r.NotRead, r.Waiting, r.Trouble }) it.SubItems.Add(v ?? "");
                    if (!string.IsNullOrEmpty(r.NotRead) || !string.IsNullOrEmpty(r.Trouble)) it.ForeColor = Color.FromArgb(180, 83, 9);
                    cos.Items.Add(it);
                }
                if (rows.Count == 0) cos.Items.Add(new ListViewItem("No company kept in step yet: open a company in TallyPrime."));
                cos.EndUpdate();
            }
            updInfo.Text = "FinCom Connector " + App.Version + "\nTally Bridge " + (string.IsNullOrEmpty(sup.EngineVersion) ? "(not answering)" : sup.EngineVersion) + ", " + sup.State + (sup.Restarts > 0 ? ", restarted " + sup.Restarts + " time(s) since this Connector started" : "") +
                (Updater.LastResult != "" ? "\n" + Updater.LastResult : "");
            if (tabs.SelectedIndex == 2) ShowLog();
        }
        // the two lines at the top, in plain words
        void ShowTop(List<Check> list)
        {
            var sup = Supervisor.Current;
            startStop.Text = sup.StoppedByYou ? "\u25B6  Start" : "\u25A0  Stop";
            Action<Color, string, string> set = (c, a, b) => { bigState.ForeColor = c; bigState.Text = a; todo.Text = b; };
            if (sup.StoppedByYou){ set(Color.DimGray, "\u25A0  Stopped", "FinCom cannot reach Tally and nothing is copied. Press Start to switch it on again."); return; }
            if (list == null) return;
            var bad = list.FirstOrDefault(c => c.Level == "bad"); var warn = list.FirstOrDefault(c => c.Level == "warn");
            if (bad != null) set(Color.FromArgb(185, 28, 28), "\u2716  Not working: " + bad.Name, bad.Say + (bad.Fix != "" ? "  What to do: " + bad.Fix : ""));
            else if (warn != null) set(Color.FromArgb(180, 83, 9), "!  Working, one thing to look at", warn.Name + ": " + warn.Say + (warn.Fix != "" ? "  " + warn.Fix : ""));
            else set(Color.FromArgb(21, 128, 61), "\u2714  Working", "Tally answers and FinCom can reach it" + (string.IsNullOrEmpty(sup.EngineVersion) ? "." : " (bridge " + sup.EngineVersion + ").") + " You can close this window: it keeps running near the clock.");
        }
        static string Day(string d8) { return d8 != null && d8.Length == 8 ? d8.Substring(6, 2) + "-" + d8.Substring(4, 2) + "-" + d8.Substring(0, 4) : d8; }
        void ShowLog()
        {
            var text = App.Tail(App.BridgeLog, 400 * 1024) + "\n" + App.Tail(App.OwnLog, 100 * 1024);
            var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0);
            if (errorsOnly.Checked) lines = lines.Where(l => System.Text.RegularExpressions.Regex.IsMatch(l, @"ERROR|failed|did not|could not|not valid|stopped|blocked|took [0-9]", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
            if (logFilter.Text.Trim() != "") lines = lines.Where(l => l.IndexOf(logFilter.Text.Trim(), StringComparison.OrdinalIgnoreCase) >= 0);
            var arr = lines.ToArray();
            logBox.Text = string.Join(Environment.NewLine, arr.Skip(Math.Max(0, arr.Length - 3000)));
            logBox.SelectionStart = logBox.Text.Length; logBox.ScrollToCaret();
        }
        void DoUpdate(bool auto)
        {
            lastUpdateCheck = DateTime.Now;
            if (auto)
            {
                // never in the middle of posting to Tally
                try { var st = Bridge.Call("/status", null, 10000); object j; if (st.TryGetValue("jobs", out j) && j is System.Collections.ArrayList && ((System.Collections.ArrayList)j).Count > 0) { lastUpdateCheck = DateTime.Now.AddHours(-5.5); return; } } catch { }
            }
            updInfo.Text += "\nChecking for updates…";
            ThreadPool.QueueUserWorkItem(_ =>
            {
                var r = Updater.CheckAndApply(auto, () => BeginInvoke((Action)(() => { quitting = true; Close(); })));
                try { BeginInvoke((Action)(() => { updInfo.Text = updInfo.Text.Replace("\nChecking for updates…", "") + "\n" + r; if (!auto) MessageBox.Show(r, App.Name); })); } catch { }
            });
        }
        // a round green (or amber, or red) mark with an F, drawn here so no picture file is needed
        static Icon MakeIcon(Color c)
        {
            var bmp = new Bitmap(32, 32);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (var b = new SolidBrush(c)) g.FillEllipse(b, 1, 1, 30, 30);
                using (var f = new Font("Segoe UI", 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var w = new SolidBrush(Color.White))
                {
                    var sz = g.MeasureString("F", f);
                    g.DrawString("F", f, w, (32 - sz.Width) / 2 + 1, (32 - sz.Height) / 2);
                }
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }
}
