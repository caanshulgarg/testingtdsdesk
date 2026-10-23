package main

// Review 244 H1 (the owner's decision of 12-Oct-2026, items 3 and 5): Tally's whole entry, as the Day Book gives it, carries a
// salary payment's bank details per employee. The day files the bridge keeps (and sends to the cloud's Day Book path) never
// hold ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING: taken out before a day file is written and again before a day is sent
// (a day file an older bridge wrote). Real TallyPrime 7.1: Tally's full export of a salary payment (run 38253610530).

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var bankWords244 = []string{"<ACCOUNTNUMBER", "<IFSCODE", "<PAYMENTFAVOURING", "50100123456781", "50100123456782", "50100123456783", "HDFC0001001", "HDFC0001002", "HDFC0001003", "HDFC Bank Ltd"}

func bankLeft244(x string) []string {
	var l []string
	for _, w := range bankWords244 {
		if strings.Contains(x, w) {
			l = append(l, w)
		}
	}
	return l
}

func TestPayrollDayFileNoBankDetails(t *testing.T) {
	raw := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "full-SAL-PAY-NOV.xml.gz"))
	if len(bankLeft244(raw)) < 6 {
		t.Fatalf("the capture no longer carries the bank details this test is about: %v", bankLeft244(raw))
	}
	d := tagDate(reVchBlock.FindString(raw), "DATE")
	dir := t.TempDir()
	n, _ := saveKeepDaysChanged(dir, d, d, raw, true)
	day := readText(filepath.Join(dir, "days", d+".xml"))
	if n != 1 || countVouchers(day) != 1 {
		t.Fatalf("the entry was not kept: %d, %d", n, countVouchers(day))
	}
	if l := bankLeft244(day); len(l) > 0 {
		t.Fatalf("the day file keeps the bank details: %v", l)
	}
	for _, w := range []string{"<BANKEMPLOYEENAME", "FC Emp One", "<GUID>", "<ALTERID>", "<BANKALLOCATIONS.LIST>"} {
		if !strings.Contains(day, w) {
			t.Fatalf("the day file lost %q (only the bank details go)", w)
		}
	}
	// nothing else of the entry changed: the text with the three elements taken out of the original
	if strings.Count(day, "<AMOUNT>") != strings.Count(raw, "<AMOUNT>") {
		t.Fatalf("amounts lost: %d of %d", strings.Count(day, "<AMOUNT>"), strings.Count(raw, "<AMOUNT>"))
	}
	// review 244 R2-M1: the employee's own bank goes only from an allocation that names an employee
	alloc := func(emp string) string {
		return "<BANKALLOCATIONS.LIST><BANKEMPLOYEENAME>" + emp + "</BANKEMPLOYEENAME><BANKNAME>Their Bank</BANKNAME><BANKBRANCHNAME>B</BANKBRANCHNAME><AMOUNT>-1.00</AMOUNT></BANKALLOCATIONS.LIST>"
	}
	if got := dropBankDetails(alloc("Emp A") + alloc("") + "<TAXBANKNAME>Challan Bank</TAXBANKNAME>"); got != "<BANKALLOCATIONS.LIST><BANKEMPLOYEENAME>Emp A</BANKEMPLOYEENAME><AMOUNT>-1.00</AMOUNT></BANKALLOCATIONS.LIST>"+alloc("")+"<TAXBANKNAME>Challan Bank</TAXBANKNAME>" {
		t.Fatalf("the employee's own bank: %s", got)
	}
	if dropBankDetails("<X><ACCOUNTNUMBER/><IFSCODE TYPE=\"String\">A</IFSCODE><PAYMENTFAVOURING>B</PAYMENTFAVOURING><ACCOUNTNUMBERX>k</ACCOUNTNUMBERX></X>") != "<X><ACCOUNTNUMBERX>k</ACCOUNTNUMBERX></X>" {
		t.Fatal("dropBankDetails: an empty element, attributes, or a longer tag name handled wrong")
	}
}

// a day file an older bridge wrote with the bank details: sent without them
func TestPayrollDaySentNoBankDetails(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	raw := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "full-SAL-PAY-NOV.xml.gz"))
	m := reVchBlock.FindString(raw)
	d := tagDate(m, "DATE")
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	_ = saveFile(filepath.Join(dir, "days", d+".xml"), "<TALLYMESSAGE>"+m+"</TALLYMESSAGE>") // as 2.4.3 kept it
	_ = saveFile(dayFullMark(dir, d), nowS())
	addCloudDays(dir, []string{d})
	cloudMu.Lock()
	cloudLinks[zz] = true
	err := pushCloudCompany(zz, dir, time.Minute)
	cloudMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	e := c.dayEntries()[d]
	if e == nil {
		t.Fatalf("the day was not sent: %v", c.dayEntries())
	}
	var txt string
	if g := str(e["gz"]); g != "" {
		b, _ := base64.StdEncoding.DecodeString(g)
		r, err := gzip.NewReader(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		x, _ := io.ReadAll(r)
		txt = string(x)
	} else {
		b, _ := base64.StdEncoding.DecodeString(str(e["b64"]))
		txt = string(b)
	}
	if countVouchers(txt) != 1 || !strings.Contains(txt, "<BANKEMPLOYEENAME") {
		t.Fatalf("the day sent is not the entry: %d", countVouchers(txt))
	}
	if l := bankLeft244(txt); len(l) > 0 {
		t.Fatalf("the day sent to the cloud keeps the bank details: %v", l)
	}
}

// review 244 R2-L1: day files an earlier bridge kept with the bank details are cleaned once, their month file put together
// again and the days queued for the cloud; a clean folder is left as it is
func TestPayrollOldDayFilesCleanedOnce(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	raw := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "full-SAL-PAY-NOV.xml.gz"))
	m := reVchBlock.FindString(raw)
	d := tagDate(m, "DATE")
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	old := "<TALLYMESSAGE>" + m + "</TALLYMESSAGE>"
	_ = saveFile(filepath.Join(dir, "days", d+".xml"), old) // as 2.4.3 kept it
	_ = saveFile(filepath.Join(dir, "days", "20261203.xml"), "")
	writeKeepMonthFile(dir, d[:6])
	if len(bankLeft244(readText(filepath.Join(dir, "daybook-"+d[:6]+".xml")))) == 0 {
		t.Fatal("the month file was not made with the old day")
	}
	if n := bankCleanOnce(dir); n != 1 {
		t.Fatalf("%d day(s) cleaned, want 1", n)
	}
	for _, fl := range []string{filepath.Join(dir, "days", d+".xml"), filepath.Join(dir, "daybook-"+d[:6]+".xml")} {
		x := readText(fl)
		if l := bankLeft244(x); len(l) > 0 || !strings.Contains(x, "<BANKEMPLOYEENAME") || countVouchers(x) != 1 {
			t.Fatalf("%s: left %v, entries %d", filepath.Base(fl), l, countVouchers(x))
		}
	}
	if q := cloudQueue(dir); len(q) != 1 || q[0] != d {
		t.Fatalf("the cleaned day is not queued for the cloud: %v", q)
	}
	// once: an old day put back is left (the mark), and a second call does nothing
	_ = saveFile(filepath.Join(dir, "days", d+".xml"), old)
	if n := bankCleanOnce(dir); n != 0 || readText(filepath.Join(dir, "days", d+".xml")) != old {
		t.Fatal("cleaned twice")
	}
	// the round sends the day clean (the send cleans again too)
	cloudMu.Lock()
	cloudLinks[zz] = true
	err := pushCloudCompany(zz, dir, time.Minute)
	cloudMu.Unlock()
	if err != nil || c.dayEntries()[d] == nil {
		t.Fatalf("the day was not sent: %v", err)
	}
}

// review 244 R3-L2: a cloud that is off on the first round does not lose the days to send again; the disk is cleaned at once
func TestPayrollOldDayFilesCloudOffFirst(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	raw := gz242(t, filepath.Join("testdata", "payroll244", "7.1", "full-SAL-PAY-NOV.xml.gz"))
	m := reVchBlock.FindString(raw)
	d := tagDate(m, "DATE")
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	_ = saveFile(filepath.Join(dir, "days", d+".xml"), "<TALLYMESSAGE>"+m+"</TALLYMESSAGE>")
	url := cfgS("CloudUrl")
	setCfg("CloudUrl", "")
	if n := bankCleanOnce(dir); n != 1 || len(bankLeft244(readText(filepath.Join(dir, "days", d+".xml")))) > 0 {
		t.Fatalf("the disk not cleaned with the cloud off: %d", n)
	}
	if exists(filepath.Join(dir, "bank-clean-244.txt")) || len(cloudQueue(dir)) != 0 {
		t.Fatal("marked done (or queued) while the cloud is off")
	}
	setCfg("CloudUrl", url)
	bankCleanOnce(dir)
	if q := cloudQueue(dir); len(q) != 1 || q[0] != d || !exists(filepath.Join(dir, "bank-clean-244.txt")) {
		t.Fatalf("the day not queued once the cloud is on: %v", q)
	}
}
