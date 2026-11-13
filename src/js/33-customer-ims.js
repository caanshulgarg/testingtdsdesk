/* ================================================================== */
/* Our invoices and credit notes rejected by the customer in IMS      */
/* ================================================================== */
// The customer's IMS is theirs: nothing about their action comes to us in a file, so the rejections are marked
// here by hand, document by document, from the books' own sales. What each one does:
//  - an invoice rejected: our tax stays as reported. If the invoice is right, the customer accepts it (before their 3B)
//    or we send it again by amending it; if it is wrong, it is corrected in Tally (reported as an amendment) or cancelled
//    by a credit note.
//  - a credit note rejected: the portal adds its tax back to our liability, in the 3B of the month after the customer
//    rejected it. That add-back is put into 3.1(a) here in the same month, and taken out again if the customer later
//    accepts it (usually after we amend and send it again).
// CustIMS: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
// the "Rejected by customers in IMS" card under GSTR-1: React (app/src/screens/gst/CustIms.jsx)
// a document marked as rejected by the customer, or not after all
function custImsAdd(id){ CustIMS.add(S.gstReg || "", id); S.custImsQ = ""; GSTR._carry = null; saveBooks(); render(); }
function custImsRemove(id){ delete CustIMS.store(S.gstReg || "")[id]; GSTR._carry = null; saveBooks(); render(); }
// what is kept for one: rejYm, addYm, doneYm, act, remark
function custImsSet(id, key, val){
  const s = CustIMS.store(S.gstReg || "")[id]; if (!s) return;
  s[key] = val; if (key === "act" && val === "accepted" && !s.doneYm) s.doneYm = s.addYm;
  GSTR._carry = null; saveBooks(); if (key !== "remark") render();
}
function custImsLetter(gstin){
  const reg = S.gstReg || "", c = CustIMS.customers(reg).find(z => z.gstin === gstin); if (!c) return;
  (navigator.clipboard ? navigator.clipboard.writeText(CustIMS.letter(reg, c.gstin, c.party, c.items)) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy.", {sticky: false}));
}
