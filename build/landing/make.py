PH = "/tmp/claude-0/ph/package/assets/regular/"
def icon(name, cls="ic"):
    s = open(PH + name + ".svg").read()
    return s.replace('<svg ', '<svg class="%s" aria-hidden="true" focusable="false" ' % cls, 1)
APP = "../"; REG = APP + "#register"; SIGN = APP + "#signin"
MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M9 11h14M16 11v12" stroke="var(--mark-ink)" stroke-width="3" stroke-linecap="round"/></svg>'
CSS = open("/tmp/claude-0/landing/style2.css").read()
def cap(ic, title, items):
    return '<div class="cap rise"><div class="cap-h">%s<h3>%s</h3></div><ul>%s</ul></div>' % (icon(ic), title, "".join("<li>%s</li>" % i for i in items))
def pt(ic, text):
    return '<div class="pt">%s<p>%s</p></div>' % (icon(ic), text)
def faq(q, a):
    return '<details class="qa"><summary>%s%s</summary><p>%s</p></details>' % (q, icon("arrow-right", "ic chev"), a)
HTML = f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src SCRIPT_HASH; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>TDS Desk: books, TDS, GST, MIS and audit review, in Tally</title>
<meta name="description" content="For business owners and their CAs: bills and bank statements into Tally with TDS and GST done, then a monthly MIS and an audit review of the books. Built by Garg Shekhar &amp; Company, Chartered Accountants.">
<meta name="theme-color" content="#0f3d33">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231F6F5C'/%3E%3Cpath d='M9 11h14M16 11v12' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="preload" href="fonts/ibm-plex-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>{CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <nav class="wrap nav" aria-label="Main">
    <a class="brand" href="./">{MARK}<span>TDS Desk</span></a>
    <div class="links"><a href="#insight">MIS and audit</a><a href="#what">What it does</a><a href="#tally">Tally</a><a href="#security">Security</a><a href="#faq">Questions</a></div>
    <div class="cta"><a class="btn ghost hide-sm" href="{SIGN}">Sign in</a><a class="btn primary" href="{REG}">Register</a></div>
    <details class="menu"><summary aria-label="Menu">{icon("list")}</summary>
      <div class="menu-panel"><a href="#insight">MIS and audit</a><a href="#what">What it does</a><a href="#tally">Tally</a><a href="#security">Security</a><a href="#compliance">Compliance</a><a href="#faq">Questions</a><a class="btn ghost" href="{SIGN}">Sign in</a></div>
    </details>
  </nav>
</header>
<main id="main">
  <section class="hero" aria-labelledby="hero-h">
    <div class="wrap">
      <div class="panel">
        <div class="hero-copy">
          <h1 id="hero-h">Know your business finance in one click.</h1>
          <p class="lede">Bills and bank statements go into Tally with TDS and GST done. Then your MIS and an audit review, every month.</p>
          <div class="actions"><a class="btn light lg" href="{REG}">Register {icon("arrow-right")}</a><a class="btn outline lg" href="{SIGN}">Sign in</a></div>
        </div>
        <div class="hero-shot"><img src="img/mis-screen.webp" width="1600" height="800" alt="The MIS in TDS Desk for a year of a textile company's books: sales, profit before tax, cash in and out, money owed to and by the business, and the tax dates coming up" fetchpriority="high"></div>
      </div>
      <ul class="facts">
        <li>{icon("stamp")}<span>New Income-tax Act 2025 sections, with the old section numbers alongside</span></li>
        <li>{icon("plugs-connected")}<span>Posts to TallyPrime and reads every entry back to check it</span></li>
        <li>{icon("map-pin")}<span>Client data stored in India</span></li>
        <li>{icon("desktop")}<span>Free OCR that runs on your own computer</span></li>
      </ul>
    </div>
  </section>

  <section id="insight" class="insight" aria-labelledby="i-h">
    <div class="wrap">
      <p class="eyebrow rise">MIS and audit review</p>
      <h2 id="i-h" class="rise">See how the business is doing, and what needs fixing, before the auditor does.</h2>
      <div class="ins-grid">
        <article class="ins rise">
          <div class="ins-shot"><img src="img/mis.webp" width="1500" height="476" alt="The MIS summary in TDS Desk: sales, profit before tax, cash received and paid, money owed to and by the business, MSME dues and GST payable" loading="lazy"></div>
          <div class="ins-body">
            <h3>{icon("chart-line-up")}Your month on one page</h3>
            <p>Read straight from Tally. Sales, profit, cash in and out, who owes you, who you owe, and what tax is due next.</p>
            <ul class="ticks">
              <li>{icon("check")}Profit and loss month by month, open to the vouchers</li>
              <li>{icon("check")}Receivable and payable ageing, with MSME dues past 45 days (section 43B(h))</li>
              <li>{icon("check")}Cash flow with a 13-week forecast, ratios, and budget against actual</li>
              <li>{icon("check")}A PDF pack and Excel, made on its own every month if you want</li>
            </ul>
          </div>
        </article>
        <article class="ins rise">
          <div class="ins-shot"><img src="img/audit.webp" width="1500" height="672" alt="An audit finding in TDS Desk: a cash payment above 10,000 rupees under section 40A(3), with its effect, what to do and the voucher behind it" loading="lazy"></div>
          <div class="ins-body">
            <h3>{icon("magnifying-glass")}An audit review of every voucher</h3>
            <p>Checks the whole year's books the way an auditor would, and tells you what each finding costs and how to put it right.</p>
            <ul class="ticks">
              <li>{icon("check")}Cash payments over 10,000 rupees, TDS not deducted, duplicate bills and more</li>
              <li>{icon("check")}Each finding with its tax effect, what to do, and the vouchers behind it</li>
              <li>{icon("check")}Journal entries to pass, ready to post to Tally</li>
              <li>{icon("check")}A report with annexures and a Form 3CD draft for your CA</li>
            </ul>
          </div>
        </article>
      </div>
    </div>
  </section>

  <section class="who" aria-labelledby="who-h">
    <div class="wrap">
      <h2 id="who-h" class="rise">For the business owner, and the CA who keeps the books.</h2>
      <div class="two">
        <article class="aud rise">
          {icon("users-three", "ic big")}
          <h3>Business owners</h3>
          <p>Know where the money is every month, without waiting for the year-end. Your accountant keeps Tally up to date in minutes, not days.</p>
          <ul class="ticks"><li>{icon("check")}Monthly MIS: profit, cash, who owes you and who you owe</li><li>{icon("check")}An audit review that catches tax risks early</li><li>{icon("check")}Bank and vendor balances that match Tally, to the rupee</li></ul>
        </article>
        <article class="aud alt rise">
          {icon("buildings", "ic big")}
          <h3>Chartered accountants and their teams</h3>
          <p>Run many clients from one account. Your staff share the same data, each with their own login and role.</p>
          <ul class="ticks"><li>{icon("check")}TDS and GST for every client in one place</li><li>{icon("check")}Returns, challans and certificates tracked per client</li><li>{icon("check")}MIS and audit review for every client, on a schedule</li></ul>
        </article>
      </div>
    </div>
  </section>

  <section id="what" class="what" aria-labelledby="what-h">
    <div class="wrap">
      <p class="eyebrow rise">What TDS Desk does</p>
      <h2 id="what-h" class="rise">Everything between the paperwork and the return.</h2>
      <div class="caps">
        {cap("tray-arrow-down", "Record", ["Purchase bills from PDF, photo or email, read and checked", "Bank statements in PDF or Excel, turned into receipts and payments", "Sales invoices and marketplace settlements", "A shared inbox for documents sent by clients or your office"])}
        {cap("scales", "TDS", ["The right section and rate for each bill, and the yearly limit per deductee", "Lower-deduction certificates (section 197) and higher rates for non-filers", "Challans from Tally payments", "24Q and 26Q files ready for the FVU"])}
        {cap("receipt", "GST", ["GSTR-1, GSTR-3B, IFF and GSTR-1A worked out from the books", "2B and IMS matching, with follow-ups for missing credit", "Amendments, advances and ITC reversals", "GSTR-9 and 9C, and filing through the GST API"])}
        {cap("chart-pie-slice", "MIS and audit", ["Monthly MIS: profit, cash flow, ageing, ratios and budget", "Audit review of every voucher, with a Form 3CD draft", "Financial statements from the Tally books", "Bank and vendor ledger reconciliation against Tally"])}
      </div>
    </div>
  </section>

  <section class="show" aria-label="Screens from TDS Desk">
    <div class="wrap">
      <div class="row rise">
        <div class="copy"><h3>A month of bills, reviewed in one table.</h3><p>Every bill shows its TDS section, the tax, and how far the vendor has gone against this year's limit. Tick the ones you agree with and approve them together.</p></div>
        <div class="frame"><img src="img/bill-table.webp" width="1400" height="609" alt="A table of uploaded bills with payment type, TDS and each vendor's running total against the yearly limit" loading="lazy"></div>
      </div>
      <div class="row flip rise">
        <div class="copy"><h3>Bank statements that add up before they reach Tally.</h3><p>Each statement is checked line by line against its running balance. Lines are matched to your ledgers by rules you set once, then posted in batches.</p></div>
        <div class="frame"><img src="img/bank.webp" width="1500" height="709" alt="A bank statement in TDS Desk with opening and closing balances, and each line waiting for a Tally ledger" loading="lazy"></div>
      </div>
    </div>
  </section>

  <section id="tally" class="tally" aria-labelledby="tally-h">
    <div class="wrap">
      <h2 id="tally-h" class="rise">Works with the TallyPrime you already use.</h2>
      <p class="intro rise">A small program, the Tally Bridge, runs on the computer where Tally is open. Nothing about Tally is opened to the internet.</p>
      <ol class="flow rise">
        <li><span class="node">{icon("cloud-check")}<b>TDS Desk</b><small>in your browser</small></span></li>
        <li class="arrow" aria-hidden="true">{icon("arrow-right")}</li>
        <li><span class="node hi">{icon("plugs-connected")}<b>Tally Bridge</b><small>on your computer</small></span></li>
        <li class="arrow" aria-hidden="true">{icon("arrow-right")}</li>
        <li><span class="node">{icon("desktop-tower")}<b>TallyPrime</b><small>your company</small></span></li>
      </ol>
      <div class="grid3 rise">
        <div><h3>Posts in batches</h3><p>Hundreds of entries go in one run. Nothing is sent without a valid date inside the company's books.</p></div>
        <div><h3>Reads back and checks</h3><p>After posting, each entry is found in Tally again and the bank balance is compared with the statement.</p></div>
        <div><h3>Fixes differences</h3><p>If Tally and the statement disagree, you see each difference, with a button to post what is missing or remove a wrong entry.</p></div>
      </div>
    </div>
  </section>

  <section id="security" class="sec" aria-labelledby="s-h">
    <div class="wrap">
      <p class="eyebrow rise">Security</p>
      <h2 id="s-h" class="rise">Your clients' books stay yours.</h2>
      <div class="sec-grid">
        <div class="frame narrow rise"><img src="img/two-step.webp" width="620" height="890" alt="The optional two-step sign-in set-up in TDS Desk, with a QR code to scan in an authenticator app" loading="lazy"></div>
        <div class="groups">
          <div class="group rise"><h3>Access</h3>
            {pt("shield-check", "Each firm's data is walled off by the database itself. One firm can never read another's.")}
            {pt("lock-key", "Signs out after 30 minutes without use, and ends the session on the server too.")}
            {pt("fingerprint", "Your last sign-in is shown every time. Add a code from your phone as a second step if you want it.")}
          </div>
          <div class="group rise"><h3>Data</h3>
            {pt("map-pin", "Stored in India, in the Mumbai region, encrypted at rest and in transit.")}
            {pt("file-text", "A permanent audit trail of sign-ins, posts to Tally and deletions. It cannot be edited.")}
            {pt("eye-slash", "Scripts on the site come only from our own servers. No passwords or keys are kept in your browser.")}
          </div>
          <p class="note">When you choose AI reading for a difficult bill, its image is sent to Anthropic or Google for reading only. Their terms do not allow it to be used for training.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="compliance" class="comp-s" aria-labelledby="c-h">
    <div class="wrap">
      <h2 id="c-h" class="rise">Certification and compliance.</h2>
      <p class="intro rise">Where we stand today, stated plainly.</p>
      <div class="comp rise">
        <div class="tile">{icon("certificate")}<h3>ISO/IEC 27001:2022</h3><span class="status wait">In progress</span><p>Our information security management system is written against all 93 Annex A controls. The certification audit follows.</p></div>
        <div class="tile">{icon("seal-check")}<h3>VAPT</h3><span class="status wait">Scheduled</span><p>Independent testing by a CERT-In empanelled auditor. The summary report will be shared with clients on request.</p></div>
        <div class="tile">{icon("database")}<h3>DPDP Act 2023</h3><span class="status wait">In progress</span><p>Data used only for the work you ask for, deleted on request, and firms told without delay if anything goes wrong.</p></div>
        <div class="tile">{icon("check-circle")}<h3>CERT-In Directions 2022</h3><span class="status">In place</span><p>An incident process with reporting to CERT-In within 6 hours, and an audit trail kept for at least 180 days.</p></div>
      </div>
      <p class="honest rise">TDS Desk is not yet ISO 27001 certified. We will publish the certificate and the VAPT summary on this page when they are issued.</p>
    </div>
  </section>

  <section id="faq" class="faq" aria-labelledby="q-h">
    <div class="wrap faq-grid">
      <h2 id="q-h" class="rise">Questions firms ask us.</h2>
      <div class="qas rise">
        {faq("I run a business, not a CA firm. Can I use it?", "Yes. Register your business as the account and add your own company. Your accountant can work in the same account with their own login, and you see the MIS and audit review yourself.")}
        {faq("Do I need to install anything?", "TDS Desk runs in Chrome or Edge. To post to Tally, you install the Tally Bridge once on the computer where TallyPrime runs. It needs no administrator rights.")}
        {faq("Which version of Tally does it work with?", "TallyPrime, with the company open and TallyPrime set to act as a server (F1 Help, Settings, Connectivity). Each user's Tally can use its own port.")}
        {faq("Can my staff use it for different clients?", "Yes. The firm owner adds people with their own login and a role: owner, staff or read-only. Everyone sees the same clients and data.")}
        {faq("Where is our data kept?", "In India, in the Mumbai region. Each computer also keeps a working copy, so work carries on if the internet drops, and syncs when it is back.")}
        {faq("Is our data used to train AI?", "No. AI reading is used only for bills the free OCR cannot read, and only when your firm allows it. Anthropic and Google do not train on this data under their terms.")}
        {faq("What if something is posted wrongly?", "Every post to Tally is recorded. The reconciliation shows any entry that does not belong, and it can be removed from Tally with one click after you confirm.")}
      </div>
    </div>
  </section>

  <section class="close" aria-labelledby="x-h">
    <div class="wrap">
      <div class="panel end rise">
        <h2 id="x-h">See your business clearly this month.</h2>
        <p>Register, add your company, and bring in a month of bills and bank statements.</p>
        <div class="actions"><a class="btn light lg" href="{REG}">Register {icon("arrow-right")}</a><a class="btn outline lg" href="{SIGN}">Sign in</a></div>
      </div>
    </div>
  </section>
</main>
<footer>
  <div class="wrap foot">
    <a class="brand" href="./">{MARK}<span>TDS Desk</span></a>
    <p>Built and run by Garg Shekhar &amp; Company, Chartered Accountants, Noida.</p>
    <p><a href="../.well-known/security.txt">Report a security issue</a></p>
  </div>
</footer>
<script>SCRIPT_JS</script>
</body>
</html>
"""
HTML = HTML.replace("SCRIPT_JS", 'document.querySelectorAll(".menu-panel a").forEach(function(a){a.addEventListener("click",function(){a.closest("details").removeAttribute("open")})});')
import hashlib as _h, base64 as _b
HTML = HTML.replace("SCRIPT_HASH", "'sha256-" + _b.b64encode(_h.sha256('document.querySelectorAll(".menu-panel a").forEach(function(a){a.addEventListener("click",function(){a.closest("details").removeAttribute("open")})});'.encode()).digest()).decode() + "'")
assert "—" not in HTML and "–" not in HTML, "dash"
open("/home/claude/testingtdsdesk/welcome/index.html", "w").write(HTML)
print(len(HTML))
