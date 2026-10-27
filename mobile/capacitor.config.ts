// FinCom for Android and iOS (branch next-mobile): the Capacitor shell around the user app (../app).
// The app inside is a copy of the web app built for the phone (../app/dist-mobile, made by scripts/build-web.mjs:
// FINCOM_MOBILE=1, the relative base "./"), so FinCom opens with no line; it talks to the same Supabase as the web.
// FINCOM_MOBILE_DB=staging (npm run sync:staging) packs the testing build instead (staging database), for internal
// testers only (Play internal track, TestFlight).
import type { CapacitorConfig } from "@capacitor/cli";

const staging = process.env.FINCOM_MOBILE_DB === "staging";

const config: CapacitorConfig = {
  // PLACEHOLDER until the owner decides (mobile-plan.md, open questions): once an app is in a store this id never changes
  appId: staging ? "live.fincom.app.staging" : "live.fincom.app",
  appName: staging ? "FinCom (testing)" : "FinCom",
  webDir: staging ? "../app/dist-mobile-test" : "../app/dist-mobile",
  // the page is served from https://localhost (Android) and capacitor://localhost (iOS): both must be in the functions'
  // ALLOWED_ORIGINS secret (server/_shared/cors.ts) before calls, the assistant and uploads work from the phone
  server: { androidScheme: "https", hostname: "localhost" },
  loggingBehavior: staging ? "debug" : "none",
  android: {
    allowMixedContent: false,
    // the WebView is not debuggable in a store build
    webContentsDebuggingEnabled: staging,
  },
  ios: {
    contentInset: "never",          // the page draws under the notch; src/lib/native.js pads with the safe areas
    limitsNavigationsToAppBoundDomains: false,
    webContentsDebuggingEnabled: staging,
  },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: "#F4F6F5", showSpinner: false },   // hidden by native.js once drawn
    StatusBar: { overlaysWebView: true },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    Keyboard: { resize: "native" },
  },
};

export default config;
