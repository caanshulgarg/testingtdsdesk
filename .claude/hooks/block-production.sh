#!/bin/sh
# Owner's rule (05-Oct-2026): no tool and no helper may reach the PRODUCTION Supabase project (tds-desk,
# nrtczucrlgalvtojwoes). Runs before every tool call, in this session and in every helper it starts. Any call whose
# input names the production project, its API host or its database host is refused before it runs. Staging is
# qbocskaiewaxqcvaunzc (tds-desk-staging).
input="$(cat)"
if printf '%s' "$input" | grep -qi 'nrtczucrlgalvtojwoes'; then
  echo "Blocked: this call names the PRODUCTION Supabase project (tds-desk, nrtczucrlgalvtojwoes). Only staging (qbocskaiewaxqcvaunzc) may be used. Owner's rule of 05-Oct-2026." >&2
  exit 2
fi
exit 0
