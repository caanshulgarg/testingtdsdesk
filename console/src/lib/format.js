const IST = { timeZone: "Asia/Kolkata" };
export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { ...IST, day: "2-digit", month: "short", year: "numeric" }) : "–");
export const fmtTime = (v) => (v ? new Date(v).toLocaleString("en-IN", { ...IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
export const fmtInr = (v) => (v === null || v === undefined || v === "" ? "–" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
export const fmtNum = (v) => (v === null || v === undefined ? "–" : Number(v).toLocaleString("en-IN"));
export function download(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
