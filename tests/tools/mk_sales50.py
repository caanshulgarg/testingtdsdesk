"""python3 tests/tools/mk_sales50.py - writes bridge-go/testdata/typed-like-7.1/partA-sales-50-items.xml: ONE sales invoice
with 50 stock items (alternately at 18% and 5% GST), typed as partA-sales-two-rates.xml (TallyPrime 7.1's typed answer;
NOT captured from a real Tally). Each item's block is that fixture's own item block (18%: Widget A's, with its cost centre;
5%: Rice B's) with its name, HSN, quantity, rate and amount changed; the party, CGST and SGST lines are the totals (CGST and
SGST each rounded once per ledger, as Tally does). GUID ...-0000001c (MasterID 28), number 250, AlterID 48."""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(HERE, "..", "..", "bridge-go", "testdata", "typed-like-7.1")
src = open(os.path.join(TD, "partA-sales-two-rates.xml")).read()
G = "226fb516-9d2d-45ad-ad78-304d86b64500"
blocks = re.findall(r"     <ALLINVENTORYENTRIES\.LIST>\n[\s\S]*?\n     </ALLINVENTORYENTRIES\.LIST>\n", src)
assert len(blocks) == 2
t18, t5 = blocks
items, tax18, tax5 = [], 0.0, 0.0
for i in range(1, 51):
    qty, rate = i, 100 + i
    a = qty * rate
    if i % 2:
        b = t18.replace(">Widget A<", ">Item %02d (18%%)<" % i).replace(">8471<", ">84%02d<" % i).replace("200.00/Nos", "%.2f/Nos" % rate) \
               .replace(" 10 Nos", " %d Nos" % qty).replace(">2000.00<", ">%.2f<" % a)
        tax18 += a
    else:
        b = t5.replace(">Rice B<", ">Item %02d (5%%)<" % i).replace(">1006<", ">10%02d<" % i).replace("50.00/Kg", "%.2f/Kg" % rate) \
              .replace(" 20 Kg", " %d Kg" % qty).replace(">1000.00<", ">%.2f<" % a)
        tax5 += a
    items.append(b)
cg = round(tax18 * 0.09 + tax5 * 0.025, 2)
total = tax18 + tax5 + 2 * cg
head = src[:src.index(blocks[0])]
tail = src[src.index(blocks[1]) + len(blocks[1]):]
head = head.replace(G + "-00000015", G + "-0000001c").replace("<VOUCHERNUMBER>201<", "<VOUCHERNUMBER>250<").replace("<NAME>201<", "<NAME>250<") \
           .replace("> 41</ALTERID>", "> 48</ALTERID>").replace("> 21</MASTERID>", "> 28</MASTERID>").replace("two items at 18% and 5%", "fifty items at 18% and 5%") \
           .replace(">-3410.00<", ">%.2f<" % -total).replace(">205.00<", ">%.2f<" % cg)
assert head.count("%.2f" % -total) == 2 and head.count("%.2f" % cg) == 2
out = head + "".join(items) + tail
open(os.path.join(TD, "partA-sales-50-items.xml"), "w").write(out)
print(len(out), "bytes; taxable", tax18 + tax5, "CGST = SGST", cg, "total", total)
