#!/bin/bash
# Builds FinCom Bridge for Windows and its installer, into bridge-go/dist/:
#   FinComBridge.exe, FinComBridge-Setup-<version>.exe (+ .sha256), latest.json (the update list, to be signed)
#   ./build.sh                     the staging build (FinCom's test site)
#   FINCOM=https://app.fincom.live/ ./build.sh      for the live site, when the owner decides
# Code signing, later: set SIGN_CMD to a command that signs the file given as its last word, e.g.
#   SIGN_CMD='osslsigncode sign -pkcs12 fincom.pfx -readpass pass.txt -t http://timestamp.digicert.com -in' (the
#   script adds the input and output names); both the program and the installer are then signed.
# A version already published (its setup in assets-test/bridge-go) is not built again: raise BridgeVersion in util.go
# first, so a computer never holds two different programs under one version. FORCE_REBUILD=1 builds it anyway (tests).
set -e
cd "$(dirname "$0")"
VERSION=$(grep -oP 'var BridgeVersion = "\K[0-9.]+' util.go)
FINCOM="${FINCOM:-https://staging.fincom.live/review/}"
if [ -e "../assets-test/bridge-go/FinComBridge-Setup-$VERSION.exe" ] && [ "$FORCE_REBUILD" != "1" ]; then
  echo "Version $VERSION is already published; raise BridgeVersion in util.go" >&2
  exit 1
fi
mkdir -p dist
python3 icons/make_icons.py >/dev/null
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags "-s -w -H windowsgui" -o dist/FinComBridge.exe .
sign() { if [ -n "$SIGN_CMD" ]; then $SIGN_CMD "$1" -out "$1.signed" && mv "$1.signed" "$1"; fi; }
sign dist/FinComBridge.exe
OUT="dist/FinComBridge-Setup-$VERSION.exe"
# POSTONLY (round 11): the companies the installed bridge may post to, e.g. POSTONLY="ZZ TEST" for the pilot; empty: any
( cd installer && makensis -V2 -DVERSION="$VERSION" -DFINCOM="$FINCOM" -DPOSTONLY="${POSTONLY:-}" -DOUTFILE="../$OUT" FinComBridge.nsi )
sign "$OUT"
( cd dist && sha256sum "FinComBridge-Setup-$VERSION.exe" > "FinComBridge-Setup-$VERSION.exe.sha256" )
EXE_SHA=$(sha256sum dist/FinComBridge.exe | cut -d' ' -f1)
cat > dist/latest.json <<J
{
 "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "bridge": {"version": "$VERSION", "url": "${FINCOM}assets/bridge-go/FinComBridge-$VERSION.exe", "sha256": "$EXE_SHA", "requireSignature": false},
 "setup": {"version": "$VERSION", "url": "${FINCOM}assets/bridge-go/FinComBridge-Setup-$VERSION.exe", "sha256": "$(cut -d' ' -f1 < dist/FinComBridge-Setup-$VERSION.exe.sha256)"}
}
J
echo "FinCom Bridge $VERSION for $FINCOM:"; ls -la dist; cat dist/*.sha256
