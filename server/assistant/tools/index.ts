// The tool modules plugged into FinCom Assistant (docs/assistant-tools.md). Add a module's import here; the order is the
// order the model sees (keep it fixed: the tool list is part of the cached prompt).
import type { ExtTool } from "./types.ts";
import { TOOLS as AUDIT } from "./audit.ts";
import { TOOLS as REPORTS } from "./reports.ts";
import { TOOLS as CERTIFICATES } from "./certificates.ts";
export const EXT_TOOLS: ExtTool[] = [
  ...AUDIT,
  ...REPORTS,
  ...CERTIFICATES,
];
