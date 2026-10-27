// node --test test/*.test.mjs  (npm test, in mobile/) - scripts/patch-native.mjs on Capacitor's own templates (the ones `npx cap add`
// copies, read here from @capacitor/cli's assets): each patch adds what FinCom needs, keeps the file valid, and changes
// nothing the second time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchManifest, patchInfoPlist, patchPbxproj, ANDROID_PERMISSIONS, SHARE_MIMES, IOS_STRINGS, ENTITLEMENTS } from "../scripts/patch-native.mjs";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@capacitor", "cli", "assets");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fincom-templates-"));
const from = (tgz, file) => { execFileSync("tar", ["xzf", path.join(ASSETS, tgz), "-C", tmp, file]); return fs.readFileSync(path.join(tmp, file), "utf8"); };
const count = (s, x) => s.split(x).length - 1;

test("Android manifest: permissions, share to FinCom, links; once", () => {
  const orig = from("android-template.tar.gz", "app/src/main/AndroidManifest.xml");
  const one = patchManifest(orig), two = patchManifest(one);
  assert.equal(two, one, "a second run changes nothing");
  for (const p of ANDROID_PERMISSIONS) assert.equal(count(one, 'android:name="' + p + '"'), 1, p);
  assert.ok(one.includes('android:name="android.intent.action.SEND"') && one.includes('android:name="android.intent.action.SEND_MULTIPLE"'), "share actions");
  for (const m of SHARE_MIMES) assert.equal(count(one, 'android:mimeType="' + m + '"'), 2, m);
  assert.ok(/android:autoVerify="true"[\s\S]*android:host="app\.fincom\.live"/.test(one) && one.includes('android:scheme="fincom"'), "app links and fincom://");
  // inside the main activity, after the launcher
  const act = one.slice(one.indexOf("<activity"), one.indexOf("</activity>"));
  assert.ok(act.indexOf("android.intent.category.LAUNCHER") < act.indexOf("action.SEND"), "in the main activity, after its launcher");
  assert.ok(one.trimEnd().endsWith("</manifest>") && count(one, "<manifest") === 1, "still one manifest");
  // every tag that opens is closed (a rough XML check: intent-filters balanced)
  assert.equal(count(one, "<intent-filter"), count(one, "</intent-filter>"));
});

for (const kind of ["ios-spm-template.tar.gz", "ios-pods-template.tar.gz"]) {
  test("iOS Info.plist (" + kind + "): the words iOS shows, background audio, fincom://; once", () => {
    const orig = from(kind, "App/App/Info.plist");
    const one = patchInfoPlist(orig);
    assert.equal(patchInfoPlist(one), one, "a second run changes nothing");
    for (const k of Object.keys(IOS_STRINGS)) assert.equal(count(one, "<key>" + k + "</key>"), 1, k);
    assert.ok(/<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>\s*<string>remote-notification<\/string>/.test(one), "background audio, remote notifications");
    assert.ok(one.includes("<string>fincom</string>") && one.trimEnd().endsWith("</plist>"), "fincom:// and still a plist");
    assert.equal(count(one, "<dict>"), count(one, "</dict>"));
  });
  test("iOS project (" + kind + "): the entitlements named for Debug and Release; once", () => {
    const orig = from(kind, "App/App.xcodeproj/project.pbxproj");
    const one = patchPbxproj(orig);
    assert.equal(patchPbxproj(one), one, "a second run changes nothing");
    assert.equal(count(one, "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;"), count(orig, "INFOPLIST_FILE = App/Info.plist;"));
    assert.ok(count(one, "CODE_SIGN_ENTITLEMENTS") >= 2, "Debug and Release");
  });
}

test("the entitlements: push for the App Store, app.fincom.live links", () => {
  assert.ok(ENTITLEMENTS.includes("<key>aps-environment</key>\n\t<string>production</string>") && ENTITLEMENTS.includes("applinks:app.fincom.live"));
});
