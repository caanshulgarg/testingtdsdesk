#!/bin/bash
# Stands in for PowerShell in the bridge tests, so they run the Go bridge (bridge-go) unchanged:
#   PWSH=tests/go_bridge_shim.sh GOBRIDGE=/path/to/fbridge python3 tests/run_xxx.py
# "pwsh -NoProfile -File <dir>/TDSBridge.ps1 [-Sync]" runs the Go bridge with <dir> as its folder; anything else goes to
# the real PowerShell (REAL_PWSH, default /opt/pwsh/pwsh).
ps1=""; sync=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  case "${args[$i]}" in
    -File) ps1="${args[$((i+1))]}";;
    -Sync) sync="sync";;
  esac
done
if [[ "$ps1" == *TDSBridge.ps1 ]]; then
  dir="$(cd "$(dirname "$ps1")" && pwd)"
  exec "${GOBRIDGE:?set GOBRIDGE to the Go bridge binary}" ${sync:-run} --config "$dir/tds-bridge.config.json" --home "$dir"
fi
exec "${REAL_PWSH:-/opt/pwsh/pwsh}" "$@"
