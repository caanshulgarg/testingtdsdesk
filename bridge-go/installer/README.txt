FinCom Bridge 2.0.0
===================

Connects TallyPrime on this computer with FinCom. The icon near the clock is green when the
bridge reaches your Tally and FinCom, red when not. Right-click it for the menu; Status shows
which way it runs.

Two ways to install it (the setup asks "Who is it for?"):
- For all users: a Windows service ("FinCom Bridge") in Program Files. It starts with Windows,
  and Windows starts it again if it ever stops. Needs an administrator (Windows asks for one).
- Just for me: no administrator needed, for a shared Tally server where you are not one. The
  program goes in %LOCALAPPDATA%\FinCom Bridge; it starts when you sign in to Windows
  (Settings > Apps > Startup lists it as "FinCom Bridge") and runs while you are signed in. It
  starts the bridge again by itself if it stops or stops answering. Updates need no
  administrator either. On a shared server only one bridge can answer on the bridge's port.

It works for the Windows user who installed it, and uses only the Tally running in that user's
login (on a shared server, other users' Tallys are never read or written).

Test mode (installed beside bridge 1.15.0): reads Tally and sends to FinCom only to be compared
with bridge 1.15.0's copy; it never posts. Postings go through bridge 1.15.0 meanwhile.
Start menu > FinCom Bridge > Compare with bridge 1.15.0 shows whether the two copies agree.

Replace mode: bridge 1.15.0 is stopped and no longer starts; this bridge takes over its pairing,
settings and copy of the books (nothing is read from Tally for the whole year again).

Files: the program in this folder; the settings, the copy of the books and the log stay in
%LOCALAPPDATA%\TDS Desk Bridge of the user it works for (either way). The setup's own log is
C:\ProgramData\FinCom Bridge\install.log, or %LOCALAPPDATA%\FinCom Bridge\install.log when
installed just for you. Uninstalling (Settings > Apps) removes the program and the service (or
the start at sign-in), and keeps the settings folder.
