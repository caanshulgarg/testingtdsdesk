// A ledger's place by its Tally group path, for the cloud's scheduled MIS (ROUND 105 B6, server/mis-run), where only the
// cloud copy is at hand (tally_ledgers: name, chain): the rules the app uses when it has no more than the groups, ported as
// they are. Pure JavaScript, no imports.
//   headOf   MIS.headByGroup (src/js/07) = the server's tally_mis_head: the MIS head (rev, oth, pur, dir, emp, exp, fin, dep, tax)
//   natureOf FS.nature's rule for Tally's own primary groups (src/js/29): income or expense, gross-profit side, debit side
//   placeOf  FS.place (src/js/29): where a balance goes in the balance sheet, by its sign
// A company's own primary group (one Tally does not reserve) has no nature in the cloud copy: such ledgers have no head
// here (the app reads Tally's group masters and knows them).
const has = (chain, g) => chain.some((x) => String(x).toLowerCase() === g);
export function headOf(l, chain) {
  if (has(chain, "sales accounts") || has(chain, "direct incomes")) return "rev";
  if (has(chain, "indirect incomes")) return "oth";
  if (has(chain, "purchase accounts")) return "pur";
  if (has(chain, "direct expenses")) return "dir";
  if (has(chain, "indirect expenses")) {
    if (/SALAR|WAGES|BONUS|STAFF|GRATUITY|\bPF\b|\bESI\b|EMPLOYEE|INCENTIVE|LEAVE/i.test(l)) return "emp";
    if (/INTEREST|FINANCE CHARGE|PROCESSING FEE|LOAN CHARGE/i.test(l) && !/INTEREST ON (TDS|GST|INCOME TAX)/i.test(l)) return "fin";
    if (/DEPRECIATION|AMORTI/i.test(l)) return "dep";
    if (/INCOME TAX|PROVISION FOR TAX|DEFERRED TAX/i.test(l)) return "tax";
    return "exp";
  }
  return "";
}
const R = { "sales accounts": [1, 1, 0], "direct incomes": [1, 1, 0], "indirect incomes": [1, 0, 0], "purchase accounts": [1, 1, 1], "direct expenses": [1, 1, 1], "indirect expenses": [1, 0, 1] };
export function natureOf(chain) {
  const top = String(chain[chain.length - 1] || ""), t = top.toLowerCase();
  if (R[t]) return { rev: !!R[t][0], gp: !!R[t][1], dr: !!R[t][2], path: chain, top };
  return { rev: false, gp: false, dr: /assets|investments|misc\. expenses|suspense|branch/.test(t), path: chain, top };
}
export function placeOf(l, chain, bal, kind) {
  const n = natureOf(chain), p = chain.map((g) => String(g).toLowerCase()), hasG = (g) => p.includes(g), up = String(l).toUpperCase();
  if (n.rev) {
    if (!n.dr) return n.gp ? "rev" : "oth";
    if (n.gp) return hasG("purchase accounts") ? "pur" : "exp";
    const txt = up + " " + chain.join(" ").toUpperCase();
    if (/DEPRECIATION|AMORTI/.test(txt)) return "dep";
    if (/INCOME TAX|PROVISION FOR TAX|DEFERRED TAX/.test(txt)) return "tax";
    if (/EMPLOYEE|SALAR|WAGES|BONUS|STAFF|GRATUITY|\bPF\b|\bESI|PROVIDENT|LEAVE ENCASH|INCENTIVE/.test(txt)) return "emp";
    if (/FINANCE|INTEREST|PROCESSING FEE|LOAN CHARGE|BANK CHARGE/.test(txt) && !/INTEREST ON (TDS|GST|INCOME TAX)/.test(up)) return "fin";
    return "exp";
  }
  if (/PROFIT\s*&\s*LOSS/i.test(l)) return "reserves";
  const dr = bal < 0, all = up + " " + chain.join(" ").toUpperCase();
  if (hasG("capital account")) return hasG("reserves & surplus") ? "reserves" : (kind === "co" ? (/SHARE|EQUITY|CAPITAL/.test(up) && !/CURRENT|DRAWING/.test(up) ? "share" : "reserves") : "capital");
  if (hasG("reserves & surplus")) return "reserves";
  if (hasG("fixed assets")) return /SOFTWARE|GOODWILL|TRADEMARK|PATENT|COPYRIGHT|LICEN[CS]E|INTANGIBLE/.test(up) ? "intang" : /CAPITAL WORK|CWIP|UNDER CONSTRUCTION/.test(up) ? "cwip" : "ppe";
  if (hasG("investments")) return /MUTUAL FUND|\bMF\b|LIQUID|\bSIP\b/.test(up) ? "ci" : "nci";
  if (hasG("stock-in-hand")) return "inv";
  if (hasG("sundry debtors")) return dr ? "tr" : "ocl";
  if (hasG("sundry creditors")) return dr ? "stla" : "tp";
  if (hasG("cash-in-hand")) return dr ? "cash" : "stb";
  if (hasG("bank od a/c") || hasG("bank occ a/c")) return dr ? "cash" : "stb";
  if (hasG("bank accounts")) return dr ? "cash" : "stb";
  if (hasG("secured loans") || hasG("unsecured loans") || hasG("loans (liability)")) return /CREDIT CARD|OVERDRAFT|\bOD\b|\bCC\b|CASH CREDIT/.test(all) ? "stb" : (dr ? "stla" : "ltb");
  if (/DEFERRED TAX/.test(up)) return dr ? "dta" : "dtl";
  if (hasG("provisions")) return /GRATUITY|LEAVE/.test(up) ? "ltp" : "stp";
  if (hasG("duties & taxes")) return dr ? "stla" : "ocl";
  if (hasG("deposits (asset)")) return /FIXED DEPOSIT|\bFD\b|FDR/.test(all) ? "cash" : (/SECURITY|RENT DEPOSIT/.test(up) ? "ltla" : "stla");
  if (hasG("loans & advances (asset)")) return dr ? "stla" : "ocl";
  if (hasG("current assets")) return dr ? (/FIXED DEPOSIT|\bFD\b/.test(all) ? "cash" : /TDS|TCS|INCOME TAX|GST|ADVANCE TAX|REFUND/.test(all) ? "stla" : "oca") : "ocl";
  if (hasG("current liabilities")) return dr ? "stla" : "ocl";
  if (hasG("misc. expenses (asset)")) return "onca";
  if (hasG("suspense a/c")) return dr ? "oca" : "ocl";
  return dr ? "oca" : "ocl";
}
// the engine's ledger record (misCustom.js data.ledgers[name]) from the cloud copy's row
export function ledgerRec(name, chain) {
  const h = headOf(name, chain), n = natureOf(chain);
  return { g: chain, h, s: h === "dir" ? "exp" : h, dc: n.dr ? -1 : 1, rev: n.rev,
    kind: has(chain, "sundry debtors") ? "r" : has(chain, "sundry creditors") ? "p" : (has(chain, "bank accounts") || has(chain, "bank od a/c") || has(chain, "bank occ a/c")) ? "bank" : has(chain, "cash-in-hand") ? "cash" : "",
    pur: has(chain, "purchase accounts"), sales: has(chain, "sales accounts"), exp: has(chain, "indirect expenses") || has(chain, "direct expenses"), fixed: has(chain, "fixed assets"),
    place: { dr: placeOf(name, chain, -1, "co"), cr: placeOf(name, chain, 1, "co") }, code: "" };
}
