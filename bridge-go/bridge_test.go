package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

// the update list is taken only with FinCom's signature: a changed list, or another key's signature, is refused
func TestSignedUpdateList(t *testing.T) {
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	dir := t.TempDir()
	pub := "<RSAKeyValue><Modulus>" + base64.StdEncoding.EncodeToString(k.N.Bytes()) + "</Modulus><Exponent>" + base64.StdEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes()) + "</Exponent></RSAKeyValue>"
	os.WriteFile(filepath.Join(dir, "pub.xml"), []byte(pub), 0o644)
	t.Setenv("FINCOM_TEST", "1")
	t.Setenv("FINCOM_TEST_PUBKEY", filepath.Join(dir, "pub.xml"))
	body := []byte(`{"bridge":{"version":"2.0.1"}}`)
	h := sha256.Sum256(body)
	sig, _ := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, h[:])
	if err := verifySigned(body, base64.StdEncoding.EncodeToString(sig)); err != nil {
		t.Fatal("a good signature was refused:", err)
	}
	if verifySigned([]byte(`{"bridge":{"version":"9.9.9"}}`), base64.StdEncoding.EncodeToString(sig)) == nil {
		t.Fatal("a changed list was taken")
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	sig2, _ := rsa.SignPKCS1v15(rand.Reader, other, crypto.SHA256, h[:])
	if verifySigned(body, base64.StdEncoding.EncodeToString(sig2)) == nil {
		t.Fatal("another key's signature was taken")
	}
	// FinCom's own key (the Connector's) is read
	os.Unsetenv("FINCOM_TEST")
	if pk, err := publicKey(); err != nil || pk.N.BitLen() < 2048 {
		t.Fatal("FinCom's update key could not be read")
	}
}

func TestVersions(t *testing.T) {
	for _, c := range [][3]string{{"2.0.1", "2.0.0", "1"}, {"2.0.10", "2.0.9", "1"}, {"2.0.0", "2.0.0", ""}, {"1.15.0", "2.0.0", ""}} {
		if newerVersion(c[0], c[1]) != (c[2] == "1") {
			t.Fatal(c)
		}
	}
}

// Tally's text: control characters and bare & made readable, names with & read back
func TestTallyXML(t *testing.T) {
	d := xmlDoc("<ENVELOPE><LEDGER NAME=\"A &amp; B\"><PARENT>Sundry &amp; Co & more\x04</PARENT><UDF:X>1</UDF:X></LEDGER></ENVELOPE>")
	l := d.All("LEDGER")
	if len(l) != 1 || nameOf(l[0]) != "A & B" || nt(l[0], "PARENT") != "Sundry & Co & more" {
		t.Fatalf("%q %q", nameOf(l[0]), nt(l[0], "PARENT"))
	}
	if textFromBytes([]byte{0xFF, 0xFE, 'O', 0, 'K', 0}) != "OK" || textFromBytes([]byte("<A>ok</A>")) != "<A>ok</A>" {
		t.Fatal("text from bytes")
	}
}
