#!/bin/sh
# builds FinComConnector.exe (for the .NET Framework 4.8 that comes with Windows) with the bridge inside it
set -e
cd "$(dirname "$0")"
mcs -nologo -target:winexe -sdk:4.5 -langversion:6 -optimize+ -out:FinComConnector.exe \
  -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.Web.Extensions.dll -r:System.IO.Compression.dll \
  -r:System.IO.Compression.FileSystem.dll -r:System.Security.dll \
  -resource:../bridge/TDSBridge.ps1,engine.ps1 \
  Core.cs UI.cs SelfTest.cs
ls -la FinComConnector.exe
