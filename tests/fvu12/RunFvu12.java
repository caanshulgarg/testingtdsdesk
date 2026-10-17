// RunFvu12 <in.txt> <out path prefix> - runs Protean's standalone FVU 1.2 (TDS_STANDALONE_FVU_1.2.jar, never committed)
// headless on one statement file and prints its error buffer after "--- errors:" (line^type^field^^^code^message per
// line; nothing when the file is valid). Used by tests/run_fvu12_forms.py.
public class RunFvu12 {
  public static void main(String[] a) throws Exception {
    com.tin.tds.FormValidator f = new com.tin.tds.FormValidator();
    try { f.u(a[0], a[1], 0); } catch (Throwable t) { System.out.println("EXC " + t); }
    System.out.println("--- errors:");
    System.out.println(f.nie != null && f.nie.xib != null ? f.nie.xib.toString() : "(none)");
    System.exit(0);
  }
}
