# Every TCP connection to one local port (Tally's), with times to the millisecond: the TCP table (GetExtendedTcpTable,
# IPv4 and IPv6) read every 20 ms; one line when a connection is first seen, when either side's state changes, and when
# it is gone. Keyed by the client's port; the client's process (and its name) from the table's owner column.
# Runs as its own process until the stop file exists (or it is stopped by its PID).
param([int]$port, [string]$out, [string]$stop)
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class TcpTab {
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr t, ref int len, bool sort, int af, int cls, uint r);
  public struct Row { public int State; public int LPort; public int RPort; public int Pid; public int Af; }
  static int P(uint v) { return (int)(((v & 0xff) << 8) | ((v >> 8) & 0xff)); }
  public static List<Row> Read() {
    var l = new List<Row>();
    foreach (int af in new[] { 2, 23 }) {
      int len = 0; GetExtendedTcpTable(IntPtr.Zero, ref len, false, af, 5, 0);
      IntPtr b = Marshal.AllocHGlobal(len + 4096); len += 4096;
      try {
        if (GetExtendedTcpTable(b, ref len, false, af, 5, 0) != 0) continue;
        int n = Marshal.ReadInt32(b);
        int sz = af == 2 ? 24 : 56; IntPtr p = b + 4;
        for (int i = 0; i < n; i++) {
          Row r = new Row(); r.Af = af;
          if (af == 2) { r.State = Marshal.ReadInt32(p); r.LPort = P((uint)Marshal.ReadInt32(p + 8)); r.RPort = P((uint)Marshal.ReadInt32(p + 16)); r.Pid = Marshal.ReadInt32(p + 20); }
          else { r.LPort = P((uint)Marshal.ReadInt32(p + 20)); r.RPort = P((uint)Marshal.ReadInt32(p + 44)); r.State = Marshal.ReadInt32(p + 48); r.Pid = Marshal.ReadInt32(p + 52); }
          l.Add(r); p += sz;
        }
      } finally { Marshal.FreeHGlobal(b); }
    }
    return l;
  }
}
'@
$names = @{ 1 = 'CLOSED'; 2 = 'LISTEN'; 3 = 'SYN_SENT'; 4 = 'SYN_RCVD'; 5 = 'ESTABLISHED'; 6 = 'FIN_WAIT1'; 7 = 'FIN_WAIT2'; 8 = 'CLOSE_WAIT'; 9 = 'CLOSING'; 10 = 'LAST_ACK'; 11 = 'TIME_WAIT'; 12 = 'DELETE_TCB' }
$w = [IO.StreamWriter]::new($out, $true, [Text.Encoding]::UTF8); $w.AutoFlush = $true
$w.WriteLine("$(Get-Date -Format 'HH:mm:ss.fff') START port $port (pid $PID)")
$seen = @{}; $pname = @{}
function PN($p) { if (-not $p) { return '' }; if (-not $pname.ContainsKey($p)) { $pname[$p] = try { (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { '?' } }; $pname[$p] }
while (-not (Test-Path $stop)) {
  $now = Get-Date -Format 'HH:mm:ss.fff'
  $cur = @{}
  foreach ($r in [TcpTab]::Read()) {
    if ($r.State -eq 2) { continue }
    if ($r.RPort -eq $port) { $k = "$($r.Af)/$($r.LPort)"; if (-not $cur[$k]) { $cur[$k] = @{ c = ''; s = ''; pid = 0 } }; $cur[$k].c = $names[$r.State]; $cur[$k].pid = $r.Pid }
    elseif ($r.LPort -eq $port) { $k = "$($r.Af)/$($r.RPort)"; if (-not $cur[$k]) { $cur[$k] = @{ c = ''; s = ''; pid = 0 } }; $cur[$k].s = $names[$r.State]; if ($r.State -ne 11) { $cur[$k].tally = $r.Pid } }
  }
  foreach ($k in $cur.Keys) {
    $v = $cur[$k]; $st = "client=$($v.c) tally=$($v.s)"
    if (-not $seen.ContainsKey($k)) { $seen[$k] = @{ st = $st; pid = $v.pid }; $w.WriteLine("$now NEW $k pid=$($v.pid) $(PN $v.pid) $st") }
    elseif ($seen[$k].st -ne $st) { $seen[$k].st = $st; if ($v.pid) { $seen[$k].pid = $v.pid }; $w.WriteLine("$now STATE $k pid=$($seen[$k].pid) $st") }
  }
  foreach ($k in @($seen.Keys)) { if (-not $cur.ContainsKey($k)) { $w.WriteLine("$now GONE $k pid=$($seen[$k].pid)"); $seen.Remove($k) } }
  Start-Sleep -Milliseconds 20
}
$w.WriteLine("$(Get-Date -Format 'HH:mm:ss.fff') STOP"); $w.Close()
