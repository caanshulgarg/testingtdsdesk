// What FinCom needs from Android and iOS beyond Capacitor's templates (branch next-mobile), put into the generated
// projects by scripts/add-platforms.mjs after `npx cap add`. Each patch is plain text in, text out, and safe to run twice
// (test/patch-native.test.mjs). What each one is for:
//   Android (android/app/src/main/AndroidManifest.xml)
//     camera (bill capture, calls), microphone (calls), notifications (Android 13+), fingerprint (the app lock), and the
//     foreground service for a call kept going when the screen is off
//     "Share to FinCom": the app takes a PDF, a photo or an Excel / CSV file sent from another app (SEND, SEND_MULTIPLE)
//     links: https://app.fincom.live/... (an App Link, verified by the site's .well-known/assetlinks.json) and fincom://open
//   iOS (ios/App/App/Info.plist, App.entitlements, the Xcode project)
//     the words iOS shows when it asks for the camera, the microphone, the photos and Face ID
//     background audio (a call goes on with the screen locked) and remote notifications
//     fincom:// links; push (aps-environment) and https://app.fincom.live links (associated domains) in the entitlements
export const ANDROID_PERMISSIONS = ["android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.POST_NOTIFICATIONS", "android.permission.USE_BIOMETRIC", "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"];
export const SHARE_MIMES = ["application/pdf", "image/*", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"];
const MARK = "<!-- fincom: ";

export function patchManifest(xml) {
  let out = xml;
  const perms = ANDROID_PERMISSIONS.filter((p) => !out.includes('android:name="' + p + '"'))
    .map((p) => '    <uses-permission android:name="' + p + '" />').join("\n");
  if (perms) out = out.replace(/(\n\s*<\/manifest>\s*)$/, "\n" + perms + "$1");
  if (!out.includes('android:name="android.hardware.camera"')) out = out.replace(/(\n\s*<\/manifest>\s*)$/, '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />$1');
  if (!out.includes(MARK + "share -->")) {
    const share = (action) => "            <intent-filter>\n                <action android:name=\"android.intent.action." + action + "\" />\n                <category android:name=\"android.intent.category.DEFAULT\" />\n" +
      SHARE_MIMES.map((m) => "                <data android:mimeType=\"" + m + "\" />").join("\n") + "\n            </intent-filter>";
    const links = "            <intent-filter android:autoVerify=\"true\">\n                <action android:name=\"android.intent.action.VIEW\" />\n                <category android:name=\"android.intent.category.DEFAULT\" />\n" +
      "                <category android:name=\"android.intent.category.BROWSABLE\" />\n                <data android:scheme=\"https\" android:host=\"app.fincom.live\" />\n            </intent-filter>\n" +
      "            <intent-filter>\n                <action android:name=\"android.intent.action.VIEW\" />\n                <category android:name=\"android.intent.category.DEFAULT\" />\n" +
      "                <category android:name=\"android.intent.category.BROWSABLE\" />\n                <data android:scheme=\"fincom\" android:host=\"open\" />\n            </intent-filter>";
    const block = "\n            " + MARK + "share -->\n" + share("SEND") + "\n" + share("SEND_MULTIPLE") + "\n            " + MARK + "links -->\n" + links;
    // into the main activity, after its launcher intent-filter
    const re = /(<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN"\s*\/>\s*<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>\s*<\/intent-filter>)/;
    if (!re.test(out)) throw new Error("patchManifest: the main activity's launcher intent-filter was not found");
    out = out.replace(re, "$1" + block);
  }
  return out;
}

export const IOS_STRINGS = {
  NSCameraUsageDescription: "FinCom uses the camera to photograph bills and statements, and for video calls.",
  NSMicrophoneUsageDescription: "FinCom uses the microphone for calls.",
  NSPhotoLibraryUsageDescription: "FinCom reads the bill or statement photos you choose.",
  NSPhotoLibraryAddUsageDescription: "FinCom saves files you export when you ask it to.",
  NSFaceIDUsageDescription: "FinCom uses Face ID to unlock, so your clients' books stay private.",
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export function patchInfoPlist(xml) {
  let add = "";
  for (const [k, v] of Object.entries(IOS_STRINGS)) if (!xml.includes("<key>" + k + "</key>")) add += "\t<key>" + k + "</key>\n\t<string>" + esc(v) + "</string>\n";
  if (!xml.includes("<key>UIBackgroundModes</key>")) add += "\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t\t<string>remote-notification</string>\n\t</array>\n";
  if (!xml.includes("<key>CFBundleURLTypes</key>")) add += "\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>FinCom</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>fincom</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n";
  if (!xml.includes("<key>ITSAppUsesNonExemptEncryption</key>")) add += "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n";
  if (!add) return xml;
  const i = xml.lastIndexOf("</dict>");
  if (i < 0) throw new Error("patchInfoPlist: no top-level <dict>");
  return xml.slice(0, i) + add + xml.slice(i);
}

export const ENTITLEMENTS = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n<dict>\n\t<key>aps-environment</key>\n\t<string>production</string>\n\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t<string>applinks:app.fincom.live</string>\n\t</array>\n</dict>\n</plist>\n';
// the App target's build settings name the entitlements file (both Debug and Release)
export function patchPbxproj(text) {
  if (text.includes("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;")) return text;
  const re = /(\n(\s*)INFOPLIST_FILE = App\/Info\.plist;)/g;
  if (!re.test(text)) throw new Error("patchPbxproj: the App target's INFOPLIST_FILE was not found");
  return text.replace(/(\n(\s*)INFOPLIST_FILE = App\/Info\.plist;)/g, "\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1");
}
