FinCom Bridge 2.0.0
===================

Connects TallyPrime on this computer with FinCom. It runs as a Windows service ("FinCom Bridge"):
it starts with Windows, and Windows starts it again if it ever stops. The icon near the clock is
green when the bridge reaches your Tally and FinCom, red when not. Right-click it for the menu.

It works for the Windows user who installed it, and uses only the Tally running in that user's
login (on a shared server, other users' Tallys are never read or written).

Test mode (installed beside bridge 1.15.0): reads Tally and sends to FinCom only to be compared
with bridge 1.15.0's copy; it never posts. Postings go through bridge 1.15.0 meanwhile.
Start menu > FinCom Bridge > Compare with bridge 1.15.0 shows whether the two copies agree.

Replace mode: bridge 1.15.0 is stopped and no longer starts; this bridge takes over its pairing,
settings and copy of the books (nothing is read from Tally for the whole year again).

Files: the program in this folder; the settings, the copy of the books and the log stay in
%LOCALAPPDATA%\TDS Desk Bridge of the user it works for. Uninstalling (Settings > Apps) removes
the program and the service, and keeps that folder.
