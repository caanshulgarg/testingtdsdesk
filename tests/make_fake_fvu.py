"""Builds a stand-in for Protean's FVU (a Java jar) so the FVU route can be tested without the real one.
A file containing "BAD" gets an error file; any other gets a .fvu. Needs a JDK (javac, or the jdk.compiler module)."""
import os, subprocess, zipfile
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "out", "fvu"); os.makedirs(D, exist_ok=True)
open(os.path.join(D, "FakeFvu.java"), "w").write('''import java.nio.file.*;
public class FakeFvu { public static void main(String[] a) throws Exception {
  String t = new String(Files.readAllBytes(Paths.get(a[0])));
  if (t.contains("BAD")) { Files.write(Paths.get(a[1]), "T-FV-1001 Invalid PAN of deductee in line 3\\n".getBytes()); System.out.println("File has errors"); }
  else { Files.write(Paths.get(a[2], "return.fvu"), "FVU OK".getBytes()); System.out.println("File validation successful"); } } }''')
open(os.path.join(D, "Build.java"), "w").write('import javax.tools.*;public class Build{public static void main(String[] a){System.exit(ToolProvider.getSystemJavaCompiler().run(null,null,null,"-d",a[0],a[1]));}}')
subprocess.run(["java", os.path.join(D, "Build.java"), os.path.join(D, "classes"), os.path.join(D, "FakeFvu.java")], check=True)
with zipfile.ZipFile(os.path.join(D, "FVU_STANDALONE.jar"), "w") as z:
    z.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nMain-Class: FakeFvu\n\n"); z.write(os.path.join(D, "classes", "FakeFvu.class"), "FakeFvu.class")
print("made", os.path.join(D, "FVU_STANDALONE.jar"))
