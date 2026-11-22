// node tests/itr_validate.mjs <form> <file.json> - a return JSON against the official CBDT schema with ajv (an
// independent JSON Schema validator, draft-04), exit 0 when it passes. The schemas: ITR_SCHEMA_DIR, else
// app/public/itr-schema (tools/itr-schemas.sh). ajv: AJV_PATH, else the copy installed with the test tools.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = process.env.ITR_SCHEMA_DIR || join(HERE, "..", "app", "public", "itr-schema");
export const FILES = { "ITR-3": "ITR-3_2026_Main_V1.1.json", "ITR-4": "ITR-4_2026_Main_V1.1.json", "ITR-5": "ITR-5_2026_Main_V1.1.json", "ITR-6": "ITR-6_2026_Main_V1.0.json" };
const require = createRequire(import.meta.url);
export function ajvFor(schema) {
  const base = process.env.AJV_PATH || "/opt/node-tools/node_modules/ajv";
  const Ajv = require(base);
  const ajv = new Ajv({ schemaId: "auto", allErrors: true, jsonPointers: true, logger: false });
  ajv.addMetaSchema(require(join(base, "lib", "refs", "json-schema-draft-04.json")));
  return ajv.compile(schema);
}
export function schemaOf(form) {
  const p = join(SCHEMA_DIR, FILES[form]);
  if (!existsSync(p)) throw new Error("the official schema is not here: run tools/itr-schemas.sh (" + p + ")");
  return JSON.parse(readFileSync(p, "utf8"));
}
if (process.argv[1] && process.argv[1].endsWith("itr_validate.mjs")) {
  const [form, file] = process.argv.slice(2);
  const v = ajvFor(schemaOf(form)), doc = JSON.parse(readFileSync(file, "utf8"));
  const root = { "ITR-3": "ITR3", "ITR-4": "ITR4", "ITR-5": "ITR5", "ITR-6": "ITR6" }[form];
  const good = v(doc) && doc.ITR && doc.ITR[root];
  console.log(good ? "valid " + form : "INVALID " + form + ": " + JSON.stringify((v.errors || []).slice(0, 5)));
  process.exit(good ? 0 : 1);
}
