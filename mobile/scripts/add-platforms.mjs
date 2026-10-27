// The Android and iOS projects (branch next-mobile): made by Capacitor (`npx cap add android`, `npx cap add ios`) when
// they are not there yet, then given what FinCom needs (scripts/patch-native.mjs: permissions, share to FinCom, links,
// the words iOS shows, background audio, push). Safe to run again: an existing project is only patched.
// Neither step needs the Android SDK, Gradle, Xcode or CocoaPods (the build does: the CI workflows,
// .github/workflows/mobile-android.yml and mobile-ios.yml). The web copy must be built first (npm run build:web).
//   node scripts/add-platforms.mjs [android] [ios]       (both when neither is named)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchManifest, patchInfoPlist, patchPbxproj, ENTITLEMENTS } from "./patch-native.mjs";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const want = process.argv.slice(2).filter((a) => a === "android" || a === "ios");
const which = want.length ? want : ["android", "ios"];
const cap = (args) => { console.log("> npx cap " + args.join(" ")); execFileSync("npx", ["cap", ...args], { cwd: MOBILE, stdio: "inherit" }); };
const edit = (rel, fn) => {
  const p = path.join(MOBILE, rel);
  const before = fs.readFileSync(p, "utf8"), after = fn(before);
  if (after !== before) { fs.writeFileSync(p, after); console.log("patched " + rel); } else console.log("already patched " + rel);
};

for (const pl of which) {
  if (!fs.existsSync(path.join(MOBILE, pl))) cap(["add", pl]);
  if (pl === "android") edit("android/app/src/main/AndroidManifest.xml", patchManifest);
  if (pl === "ios") {
    edit("ios/App/App/Info.plist", patchInfoPlist);
    const ent = path.join(MOBILE, "ios/App/App/App.entitlements");
    if (!fs.existsSync(ent)) { fs.writeFileSync(ent, ENTITLEMENTS); console.log("wrote ios/App/App/App.entitlements"); }
    edit("ios/App/App.xcodeproj/project.pbxproj", patchPbxproj);
  }
}
