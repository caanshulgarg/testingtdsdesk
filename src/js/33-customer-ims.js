function custImsLetter(gstin){
  const reg = S.gstReg || "", c = CustIMS.customers(reg).find(z => z.gstin === gstin); if (!c) return;
  (navigator.clipboard ? navigator.clipboard.writeText(CustIMS.letter(reg, c.gstin, c.party, c.items)) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy.", {sticky: false}));
}
