Captures of push-design run 37657679690 (branch tally-versions, .github/tally-spike/push/fast234.ps1, mode fast234p),
07-Oct-2026, on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (Educational mode, GitHub windows-latest), company "FinCom Spike Co"
with 4,003 vouchers. Two targets on 1-Oct-2026: a 3-item sales invoice (MasterID 4002: GST, IRN, e-way bill, cost centres,
bill-wise) and a receipt (MasterID 4003: bank details, a cost centre, bill-wise).
  <target>-bymaster.xml  Tally's answer to FinComVoucherByMaster (tax-accuracy 2.3.3, byte for byte) for that voucher
  <target>-objfl.xml     Tally's answer to the object export "ID:<MasterID>" with today's 61 fields as FETCHLIST (the
                         FETCHLIST is ignored: the whole voucher comes)
  <target>-stripped.xml  the bridge's strip of the object answer (fastvch.go fastStripVoucher), written by
                         TestFast234StripCaptures (FAST234_GOLDEN=1 rewrites them); tests/run_parse_fast234.mjs compares
                         parse.js on it with parse.js on the bymaster answer, field by field
Every file is Tally's answer as the harness's PowerShell kept it (Set-Content: UTF-8, CRLF line ends).
