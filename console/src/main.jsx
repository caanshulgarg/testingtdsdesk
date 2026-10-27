import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/console.css";
import { App } from "./App.jsx";

// light or dark: the admin's choice (kept in this browser), else the system's
const pick = () => { try { return localStorage.getItem("fincom-console:theme") || ""; } catch { return ""; } };
export function applyTheme(t = pick()) {
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
createRoot(document.getElementById("root")).render(<App />);
