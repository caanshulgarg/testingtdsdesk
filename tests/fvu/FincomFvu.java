// FinCom's own small caller of Protean's TDS FVU (run_fvu87.py): checks one statement (.txt) without the FVU's window and
// prints what the FVU found, one error or warning a line (line^type^field^...^code^message). Protean's FVU and its jars are
// Protean's software: never committed; the test finds them at $FINCOM_FVU87.
//   java -cp "<FVU jars>:<this class>" FincomFvu <statement.txt> <error file> [<challan file .csi>]
// Without a .csi (the challan file downloaded from the TIN site for the TAN) the FVU's check of the challans against
// OLTAS is turned off: every other check runs. Such a run says nothing about the challans and makes no file for filing.
public class FincomFvu {
  public static void main(String[] a) throws Exception {
    // (by name: com.tin.tds.c and com.tin.tds.a are both a class and a package in the FVU's jar)
    if (a.length > 2 && a[2].length() > 0) Class.forName("com.tin.tds.c.p").getMethod("i", String.class).invoke(null, a[2]);
    else Class.forName("com.tin.tds.a.s").getField("p").setBoolean(null, false);
    com.tin.tds.FormValidator f = new com.tin.tds.FormValidator();
    f.n(a[0], a[1], 0);
    // the FVU's buffers: errors (zjb), and what else it keeps for its reports (y, fjb: warnings and the like)
    System.out.println("--- result buffer:");
    System.out.println(f.dzd != null && f.dzd.zjb != null ? f.dzd.zjb.toString() : "");
    if (f.dzd != null && f.dzd.y != null && f.dzd.y.length() > 0) System.out.println("--- other:\n" + f.dzd.y);
    if (f.dzd != null && f.dzd.fjb != null && f.dzd.fjb.length() > 0) System.out.println("--- other:\n" + f.dzd.fjb);
    System.exit(0);
  }
}
