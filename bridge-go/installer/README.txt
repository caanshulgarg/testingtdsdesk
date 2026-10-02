FinCom Bridge 2.1.0
===================

Connects TallyPrime on this computer with FinCom. The icon near the clock is green when the
bridge reaches your Tally and FinCom, red when not; its tooltip says the mode first ("Test
mode: reading only, not posting" or "Main bridge: reading and posting"). Right-click it for
Open FinCom, Test connection (the bridge, Tally, FinCom's cloud and the pairing, one line
each), Show log, Switch to main bridge (test mode), Status, Connect FinCom, Pause, Restart,
Check for updates and Send install log to FinCom. If the icon is not near the clock, click
the ^ arrow there and drag it onto the taskbar (Windows 11 shows it by itself).

Two ways to install it (the setup asks "Who is it for?"):
- Just for me (the default): no administrator needed, also for a shared Tally server where
  you are not one. The program goes in %LOCALAPPDATA%\FinCom Bridge; it starts when you sign
  in to Windows (Settings > Apps > Startup lists it as "FinCom Bridge") and runs while you are
  signed in. It starts the bridge again by itself if it stops or stops answering. Updates need
  no administrator either. On a shared server only one bridge can answer on the bridge's port.
- For all users: a Windows service ("FinCom Bridge") in Program Files. It starts with Windows,
  and Windows starts it again if it ever stops. Needs an administrator: the setup says so
  first and asks Windows for one only if you choose Yes.

It works for the Windows user who installed it, and uses only the Tally running in that user's
login (on a shared server, other users' Tallys are never read or written).

Test mode (installed beside bridge 1.15.0): reads Tally and sends to FinCom only to be compared
with bridge 1.15.0's copy; it never posts. Postings go through bridge 1.15.0 meanwhile.
Start menu > FinCom Bridge > Compare with bridge 1.15.0 shows whether the two copies agree.
"Switch to main bridge..." in the icon's menu (or the button on FinCom's Tally page) makes it
the main bridge: bridge 1.15.0 is stopped and no longer starts, and FinCom Bridge reads and
posts, with bridge 1.15.0's pairing, settings and copy.

Replace mode (main bridge): bridge 1.15.0 is stopped and no longer starts; this bridge takes
over its pairing, settings and copy of the books (nothing is read from Tally for the whole year
again).

Install log: every step of the setup, and every failure with its reason, is in
%LOCALAPPDATA%\FinCom Bridge\install.log (for all users also C:\ProgramData\FinCom Bridge\
install.log). When the setup fails, its last page says why and offers to send that log to
FinCom; "Send install log to FinCom" in the icon's menu does the same later. A computer not yet
connected to FinCom opens FinCom's Tally page instead, where the log can be dropped by hand.

Files: the program in this folder; the settings, the copy of the books and the log stay in
%LOCALAPPDATA%\TDS Desk Bridge of the user it works for (either way). Uninstalling (Settings >
Apps) removes the program, the service (or the start at sign-in), the shortcuts and the
bridge's own files there (its copy and log of test mode, its settings); bridge 1.15.0's files
are not touched. Tick "Keep this computer's pairing with FinCom" (silent: /KEEPPAIRING) to
connect again later without a new code.
