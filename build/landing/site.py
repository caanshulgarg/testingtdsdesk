"""Builds the FinCom website into welcome/: home, pricing, security and certification, and the legal pages.
    python3 build/landing/site.py
Details still to be supplied by the company are marked with todo() and shown highlighted on the page."""
import os, re, hashlib, base64
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "welcome")

# ---- the company ----
CO = "Yuvnav Services Private Limited"
CITY = "Noida, Uttar Pradesh"
def todo(what): return '<span class="todo" title="To be filled in">[%s]</span>' % what
ADDRESS = todo("registered office address, Noida, Uttar Pradesh, PIN")
CIN = todo("CIN")
GSTIN = todo("GSTIN")
EMAIL = todo("support email")
PRIV_EMAIL = todo("privacy email")
PHONE = todo("phone")
GRIEVANCE = todo("name of the Grievance Officer")
UPDATED = "28 September 2026"

def icon(name, cls="ic"):
    s = open(os.path.join(HERE, "icons", name + ".svg")).read()
    return s.replace("<svg ", '<svg class="%s" aria-hidden="true" focusable="false" ' % cls, 1)
APP = "../"; REG = APP + "#register"; SIGN = APP + "#signin"
# the mark: an F on the brand green
MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M11 9h11M11 9v14M11 16h8" stroke="var(--mark-ink)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231F6F5C'/%3E%3Cpath d='M11 9h11M11 9v14M11 16h8' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
CSS = open(os.path.join(HERE, "style.css")).read() + open(os.path.join(HERE, "pages.css")).read()
JS = 'document.querySelectorAll(".menu-panel a").forEach(function(a){a.addEventListener("click",function(){a.closest("details").removeAttribute("open")})});'
JS_HASH = "'sha256-" + base64.b64encode(hashlib.sha256(JS.encode()).digest()).decode() + "'"

NAV = [("index.html#insight", "MIS and audit"), ("index.html#what", "Features"), ("pricing.html", "Pricing"), ("security.html", "Security"), ("index.html#faq", "Questions")]
def page(slug, title, desc, body, current=""):
    links = "".join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == current else "", t) for h, t in NAV)
    return f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src {JS_HASH}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#0f3d33">
<link rel="icon" href="{FAVICON}">
<link rel="preload" href="fonts/ibm-plex-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>{CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <nav class="wrap nav" aria-label="Main">
    <a class="brand" href="index.html" aria-label="FinCom home">{MARK}<span>FinCom</span></a>
    <div class="links">{links}</div>
    <div class="cta"><a class="btn ghost hide-sm" href="{SIGN}">Sign in</a><a class="btn primary" href="{REG}">Register</a></div>
    <details class="menu"><summary aria-label="Menu">{icon("list")}</summary>
      <div class="menu-panel">{links}<a class="btn ghost" href="{SIGN}">Sign in</a></div>
    </details>
  </nav>
</header>
{body}
<footer class="site-foot">
  <div class="wrap fgrid">
    <div class="fbrand">
      <a class="brand" href="index.html">{MARK}<span>FinCom</span></a>
      <p>Finance and compliance, in one place.</p>
      <p class="small">FinCom is a product of {CO}, {CITY}.</p>
    </div>
    <div><h3>Product</h3><a href="index.html#insight">MIS and audit</a><a href="index.html#what">Features</a><a href="pricing.html">Pricing</a><a href="{SIGN}">Sign in</a><a href="{REG}">Register</a></div>
    <div><h3>Trust</h3><a href="security.html">Security and certification</a><a href="security.html#disclose">Report a security issue</a><a href="dpa.html">Data processing terms</a></div>
    <div><h3>Legal</h3><a href="privacy.html">Privacy policy</a><a href="terms.html">Terms of use</a><a href="refund.html">Refunds and cancellation</a><a href="contact.html">Contact and grievances</a></div>
  </div>
  <div class="wrap legal-line"><p>&copy; 2026 {CO}. All rights reserved. CIN {CIN}. Tally and TallyPrime are trademarks of Tally Solutions Private Limited; FinCom is not connected with Tally Solutions.</p></div>
</footer>
<script>{JS}</script>
</body>
</html>
"""

def doc(title, intro, sections, current=""):
    toc = "".join('<a href="#s%d">%s</a>' % (i + 1, h) for i, (h, _) in enumerate(sections))
    secs = "".join('<section id="s%d" class="doc-s"><h2>%d. %s</h2>%s</section>' % (i + 1, i + 1, h, b) for i, (h, b) in enumerate(sections))
    return f"""<main id="main" class="doc">
  <div class="wrap doc-grid">
    <aside class="doc-toc" aria-label="On this page"><p>On this page</p>{toc}</aside>
    <article class="prose">
      <h1>{title}</h1>
      <p class="meta">Last updated {UPDATED}</p>
      {intro}
      {secs}
    </article>
  </div>
</main>"""

def write(slug, html):
    assert "—" not in re.sub(r"<[^>]+>", "", html) and "–" not in re.sub(r"<[^>]+>", "", html), slug + ": dash"
    open(os.path.join(OUT, slug), "w").write(html)
    print("wrote", slug, len(html))

# ---------------- home ----------------
home = open(os.path.join(HERE, "home.html")).read()
write("index.html", page("index.html", "FinCom: finance and compliance, from bills to MIS",
    "FinCom, finance and compliance: bills and bank statements into Tally with TDS and GST done, then a monthly MIS and an audit review of the books. A product of Yuvnav Services Private Limited, Noida.", home))

# ---------------- pricing ----------------
def plan(name, price, per, blurb, items, cta, hi=False):
    lis = "".join("<li>%s%s</li>" % (icon("check"), i) for i in items)
    return f"""<article class="plan{' hi' if hi else ''}">
  <h2>{name}</h2>
  <p class="price"><b>{price}</b><span>{per}</span></p>
  <p class="blurb">{blurb}</p>
  <a class="btn {'light' if hi else 'primary'}" href="{REG}">{cta}</a>
  <ul class="ticks">{lis}</ul>
</article>"""
UNIT = [("Purchase bill read and booked", "2.00", "per bill"), ("Bank statement line", "0.25", "per line"), ("Sales invoice", "2.00", "per invoice"),
        ("Reading by Claude (for bills the free OCR cannot read)", "3.00", "per bill"), ("Google Vision OCR", "1.00", "per page"),
        ("Shared data in the firm account", "100.00", "per person per month"), ("Posting into Tally", "Included", "")]
unit_rows = "".join("<tr><td>%s</td><td class='n'>%s</td><td>%s</td></tr>" % (a, ("&#8377;" + b) if b[0].isdigit() else b, c) for a, b, c in UNIT)
pricing = f"""<main id="main" class="pricing">
  <section class="p-hero"><div class="wrap">
    <h1>Simple pricing, paid from your credit.</h1>
    <p class="lede-2">Add credit once, choose a plan, and every month's fee and use is taken from the balance. No lock-in: change plans or stop at any time.</p>
  </div></section>
  <section class="p-plans"><div class="wrap plans">
    {plan("Pay as you go", "&#8377;0", "a month", "For a business or a small practice starting out. Pay only for what you use.",
      ["Every feature, including MIS and audit review", "Bills at &#8377;2, bank lines at 25 paise", "Posting into Tally included", "A warning before your credit runs low"], "Register")}
    {plan("Per client", "&#8377;75", "per client a month", "For firms with many small clients. Everything included for each client.",
      ["Unlimited bills, bank lines and sales", "AI reading by Claude and Google included", "MIS and audit review for every client", "Your whole team in one account"], "Choose per client", hi=True)}
    {plan("Small firm", "&#8377;1,500", "a month", "For a practice with a steady monthly volume.",
      ["300 bills and 3,000 bank lines a month", "100 sales invoices, 100 Claude and 200 Google readings", "Beyond that, the normal per-use prices", "MIS and audit review included"], "Choose small firm")}
    {plan("Unlimited", "&#8377;4,000", "a month", "For busy firms and larger businesses. Nothing extra, ever.",
      ["Everything unlimited, including AI reading", "All clients and all users", "Or &#8377;2,500 a month with AI reading charged per use", "Nothing charged per use"], "Choose unlimited")}
  </div>
  <p class="wrap p-note">All prices are in Indian rupees and exclude GST, which is added at 18%. Plans are paid from a prepaid credit balance; the monthly fee is taken on the first day of each month.</p>
  </section>
  <section class="p-units"><div class="wrap">
    <h2>What each use costs on Pay as you go</h2>
    <div class="tablewrap"><table class="units"><thead><tr><th>Item</th><th class="n">Price</th><th>Per</th></tr></thead><tbody>{unit_rows}</tbody></table></div>
    <p class="small">If a reading by Claude or Google fails, its charge goes back to your credit automatically.</p>
  </div></section>
  <section class="faq"><div class="wrap faq-grid">
    <h2>Questions about paying.</h2>
    <div class="qas">
      <details class="qa"><summary>How do I pay?{icon("arrow-right", "ic chev")}</summary><p>Register, and we share the payment details for {CO}. Your credit is added as soon as the payment is received, and a GST tax invoice is issued for every payment.</p></details>
      <details class="qa"><summary>What happens when the credit runs out?{icon("arrow-right", "ic chev")}</summary><p>Everything already in FinCom stays available and can still be exported. Reading new bills and statements pauses until credit is added. You get a warning before the balance runs low.</p></details>
      <details class="qa"><summary>Can I change my plan?{icon("arrow-right", "ic chev")}</summary><p>Yes, from the next month. Ask from Help inside FinCom, or write to us.</p></details>
      <details class="qa"><summary>Is there a refund?{icon("arrow-right", "ic chev")}</summary><p>Credit is prepaid for use. The cases where it is refunded are set out in our <a href="refund.html">refunds and cancellation policy</a>.</p></details>
    </div>
  </div></section>
</main>"""
write("pricing.html", page("pricing.html", "Pricing: FinCom", "FinCom pricing: pay as you go, per client, small firm or unlimited, paid from a prepaid credit balance.", pricing, "pricing.html"))

# ---------------- security and certification ----------------
def cert(ic, name, status, cls, text):
    return f'<div class="tile">{icon(ic)}<h3>{name}</h3><span class="status {cls}">{status}</span><p>{text}</p></div>'
SUBS = [("Supabase Inc.", "Database, sign-in, file storage", "India (AWS Mumbai region)"), ("GitHub (Microsoft)", "Hosting of the website and app files; no customer data", "Global"),
        ("Anthropic PBC", "AI reading of bills, only when chosen by the firm", "United States"), ("Google Cloud", "Vision OCR of pages, only when chosen by the firm", "Global"),
        ("GST Suvidha Provider", "Connection to the GST portal, when used", "India")]
sub_rows = "".join("<tr><td>%s</td><td>%s</td><td>%s</td></tr>" % s for s in SUBS)
security = f"""<main id="main" class="trust">
  <section class="p-hero"><div class="wrap">
    <h1>Security and certification.</h1>
    <p class="lede-2">Your clients' books are confidential. Here is how FinCom protects them, and where our certifications stand today.</p>
  </div></section>
  <section class="t-certs"><div class="wrap">
    <h2>Certifications</h2>
    <div class="comp">
      {cert("certificate", "ISO/IEC 27001:2022", "In progress", "wait", "Information security management system documented against all 93 Annex A controls, with a risk register and a Statement of Applicability. The certification audit by an accredited body follows.")}
      {cert("seal-check", "VAPT", "Scheduled", "wait", "Vulnerability assessment and penetration test by a CERT-In empanelled auditor, covering the web app, the cloud interfaces and the Tally Bridge.")}
      {cert("scales", "DPDP Act 2023", "In progress", "wait", "Privacy notice, purpose limitation, deletion on request, processor terms for firms, and breach notice without delay.")}
      {cert("check-circle", "CERT-In Directions 2022", "In place", "", "Incident process with reporting to CERT-In within 6 hours, a point of contact, and an audit trail kept for at least 180 days.")}
    </div>
    <p class="honest">FinCom is not yet ISO 27001 certified. The certificate and the VAPT summary will be published here when they are issued, and shared with customers on request under a non-disclosure agreement.</p>
  </div></section>
  <section class="t-practice"><div class="wrap">
    <h2>How your data is protected</h2>
    <div class="grid-p">
      <div><h3>{icon("shield-check")}Each firm walled off</h3><p>Every table in the database is locked to the firm that owns it. The database itself refuses any request for another firm's rows, whatever the screen asks for.</p></div>
      <div><h3>{icon("map-pin")}Stored in India</h3><p>Accounts and firm data are held in the Mumbai region, encrypted at rest (AES-256) and in transit (TLS 1.2 or higher). Nightly backups are kept for 14 days.</p></div>
      <div><h3>{icon("lock-key")}Sign-in</h3><p>Passwords of at least 10 characters, checked against known leaks. Automatic sign-out after 30 minutes without use. Optional two-step sign-in with an authenticator app, required for our own administrators.</p></div>
      <div><h3>{icon("file-text")}A trail that cannot be changed</h3><p>Sign-ins, every post to or deletion from Tally, and changes to people and credit are recorded in an audit trail that cannot be edited or deleted, even by us.</p></div>
      <div><h3>{icon("eye-slash")}Nothing secret in your browser</h3><p>AI and OCR keys stay on our servers. The site loads scripts only from its own address and blocks everything else, which shuts out most web attacks.</p></div>
      <div><h3>{icon("cloud-check")}Tally stays on your computer</h3><p>The Tally Bridge listens only on the computer where it runs, answers only FinCom with a paired key, and never opens Tally to the internet.</p></div>
    </div>
  </div></section>
  <section class="t-subs"><div class="wrap">
    <h2>Who processes data for us</h2>
    <p>We use a small number of service providers. Each sees only what its service needs, under contract.</p>
    <div class="tablewrap"><table class="units"><thead><tr><th>Provider</th><th>What for</th><th>Where</th></tr></thead><tbody>{sub_rows}</tbody></table></div>
    <p class="small">Bill images sent for AI reading are used only to read them. Anthropic and Google do not train their models on this data under their commercial terms.</p>
  </div></section>
  <section id="disclose" class="t-disclose"><div class="wrap two-col">
    <div><h2>Found a security problem?</h2><p>Please tell us privately. We acknowledge within 3 working days, fix critical issues within 7 days, and will not take action against good-faith research that stays within our test site and your own account.</p></div>
    <div class="box"><p><b>Report through</b></p><p><a href="https://github.com/caanshulgarg/testingtdsdesk/security/advisories/new">GitHub private advisory</a></p><p>or email {EMAIL}</p><p class="small">Details in <a href="../.well-known/security.txt">security.txt</a>.</p></div>
  </div></section>
</main>"""
write("security.html", page("security.html", "Security and certification: FinCom", "How FinCom protects your clients' books, and the status of ISO 27001, VAPT, DPDP and CERT-In compliance.", security, "security.html"))

# ---------------- privacy policy ----------------
privacy = doc("Privacy policy", f"""<p class="lead">This policy explains what personal data FinCom handles, why, and the choices you have. FinCom is operated by <b>{CO}</b> ("Yuvnav", "we", "us"), {ADDRESS}. It is written for the Digital Personal Data Protection Act, 2023 and its Rules, and the Information Technology Act, 2000.</p>""", [
 ("Two kinds of data, two roles", f"""<p><b>Your account.</b> When you register, we collect the details needed to run your account. For this data we are the Data Fiduciary.</p>
<p><b>Your clients' and your business's records.</b> Bills, bank statements, Tally books and similar records that you upload or connect are processed by us <b>on your behalf</b>. For these, you (the firm or business) are the Data Fiduciary and we are your Data Processor, under our <a href="dpa.html">data processing terms</a>. We use them only to provide FinCom to you.</p>"""),
 ("What we collect", """<ul><li><b>Account details:</b> name, email, phone number (if given), firm name, role, and your password (stored only as a one-way hash by our sign-in provider).</li>
<li><b>Records you process:</b> documents and data you upload or read from Tally, such as supplier and customer names, GSTIN, PAN, invoice details, bank transactions and salary figures.</li>
<li><b>Usage and security records:</b> sign-in times, the browser and device used, IP addresses in our server logs, and the actions recorded in the audit trail.</li>
<li><b>Payments:</b> amounts, dates and invoice details. We do not collect or store card numbers.</li>
<li><b>Support:</b> what you write to us and any files you attach to a ticket.</li></ul>"""),
 ("Why we use it", """<ul><li>To provide FinCom: read documents, work out tax, prepare returns and reports, and post to Tally at your instruction.</li>
<li>To keep accounts secure, detect misuse and investigate incidents.</li><li>To bill you and meet tax and accounting law.</li>
<li>To answer your questions and tell you about changes to the service. We do not send marketing without your consent.</li></ul>
<p>We process account data on the basis of your consent given when you register and for the legitimate uses the law allows, such as meeting legal obligations. You may withdraw consent at any time; the service then stops for that account.</p>"""),
 ("Cookies and browser storage", """<p>FinCom does not use advertising or tracking cookies, and the website has no third-party analytics. The app keeps a working copy of your firm's data in your browser's own storage so that work continues if the internet drops; you can remove it at sign-out on a shared computer. This storage is needed for the service and is never read by anyone else.</p>"""),
 ("Who we share it with", """<p>We do not sell personal data. We share it only with service providers who process it for us under contract, listed on our <a href="security.html">security page</a>: data hosting in India, and, only when your firm chooses AI reading, Anthropic or Google to read a bill image. We may also disclose data when required by law, a court or a government authority.</p>"""),
 ("Data outside India", """<p>Account and firm data are stored in India. When AI reading is chosen, the bill image is processed by the provider, which may be outside India, and is not kept by them for training. Transfers are made only to countries not restricted under the DPDP Act.</p>"""),
 ("How long we keep it", """<p>We keep data while your account is active. When an account is closed, firm data is deleted within 90 days, and backups age out within a further 14 days. Our own billing records are kept for the period tax law requires (currently eight years). Audit trail entries are kept for at least 180 days as CERT-In requires.</p>"""),
 ("How we protect it", """<p>Firm data is isolated by the database, encrypted in storage and in transit, and changes are recorded in an audit trail that cannot be edited. Details are on our <a href="security.html">security page</a>. If a breach affects your data, we tell your firm without delay and report to CERT-In and the Data Protection Board as the law requires.</p>"""),
 ("Your rights", f"""<p>You may ask to see, correct or erase your personal data, withdraw consent, and nominate a person to act for you. For records processed on behalf of a firm, please ask the firm first; we help them respond. Write to {PRIV_EMAIL}. We reply within 30 days. If you are not satisfied, you may complain to the Data Protection Board of India.</p>"""),
 ("Children", "<p>FinCom is for businesses and professionals. It is not meant for anyone under 18, and we do not knowingly collect their data.</p>"),
 ("Grievance Officer", f"""<p>{GRIEVANCE}, Grievance Officer, {CO}, {ADDRESS}. Email {PRIV_EMAIL}. We acknowledge complaints within 48 hours and aim to resolve them within 30 days.</p>"""),
 ("Changes to this policy", "<p>If we change this policy in a way that matters, we tell account owners by email or in the app at least 15 days before the change takes effect.</p>"),
])
write("privacy.html", page("privacy.html", "Privacy policy: FinCom", "How FinCom and Yuvnav Services Private Limited handle personal data under the DPDP Act 2023.", privacy))

# ---------------- terms of use ----------------
terms = doc("Terms of use", f"""<p class="lead">These terms are an agreement between you and <b>{CO}</b>, {ADDRESS} ("Yuvnav", "we"), for the use of FinCom. By registering or using FinCom you accept them on behalf of yourself and the firm or business you represent.</p>""", [
 ("The service", "<p>FinCom is software that reads financial documents, works out TDS and GST, prepares returns and reports, reviews books and posts entries to TallyPrime at your instruction. Features may change as the service improves; we will not remove a paid feature during a period you have already paid for without giving a pro-rata credit.</p>"),
 ("Your account", "<p>You must be 18 or over and able to contract. Keep passwords private and use one login per person. You are responsible for what is done under your firm's account and for the people you give access to. Tell us at once if you suspect misuse.</p>"),
 ("Professional responsibility", "<p><b>FinCom helps you work; it does not replace your professional judgement.</b> Figures, tax sections, rates, returns, audit findings and Tally entries it proposes must be checked by you or your chartered accountant before they are filed, paid or relied on. FinCom is not tax, legal or audit advice. You remain responsible for your filings, payments, books and statutory compliance.</p>"),
 ("Your data", "<p>You own the data you upload or read into FinCom. You give us permission to process it only to provide the service, as set out in the <a href=\"privacy.html\">privacy policy</a> and the <a href=\"dpa.html\">data processing terms</a>. You confirm you have the right to give us that data, including any consent your clients or staff need to give.</p>"),
 ("Fees and payment", "<p>Fees are as shown on the <a href=\"pricing.html\">pricing page</a> or agreed in writing, and exclude GST. They are paid in advance from a prepaid credit balance. We may change prices by giving at least 30 days' notice; the change applies from the next month. Refunds are covered by the <a href=\"refund.html\">refunds and cancellation policy</a>.</p>"),
 ("Acceptable use", "<p>Do not use FinCom to break the law or anyone's rights; to upload malware; to try to reach another firm's data or our systems beyond your account; to overload or reverse engineer the service; or to resell it without our written agreement. Security research is welcome within the rules on our <a href=\"security.html#disclose\">security page</a>.</p>"),
 ("Third-party services", "<p>FinCom works with services we do not control, such as TallyPrime, the GST portal and AI reading providers. Their availability and results are not guaranteed by us, and your use of them is also governed by their own terms. Tally and TallyPrime are trademarks of Tally Solutions Private Limited, which is not connected with FinCom.</p>"),
 ("Availability and support", "<p>We aim to keep FinCom available at all times and to announce planned maintenance in advance, but we do not promise uninterrupted service. Support is given through Help inside the app and by email on working days.</p>"),
 ("Our intellectual property", "<p>FinCom, its software, design and content belong to Yuvnav. You get a limited, non-transferable right to use it for your firm or business while your account is in good standing.</p>"),
 ("Suspension and ending", "<p>You may stop using FinCom and close your account at any time. We may suspend an account that breaks these terms or leaves fees unpaid, after notice unless the risk is urgent. After closing, you can export your data for 30 days; after that it is deleted as described in the privacy policy.</p>"),
 ("Limits of liability", "<p>To the extent the law allows, FinCom is provided as is, and we are not liable for indirect or consequential loss, lost profits, penalties or interest arising from filings, or loss caused by your failure to check the output. Our total liability for any claim is limited to the fees you paid us in the 12 months before the claim.</p>"),
 ("Indemnity", "<p>You will compensate us for claims by third parties arising from data you had no right to upload or from your breach of these terms.</p>"),
 ("Confidentiality", "<p>Each of us keeps the other's confidential information private and uses it only for this agreement. Our staff and service providers are bound by confidentiality obligations.</p>"),
 ("Law and disputes", "<p>These terms are governed by the laws of India. Both sides will first try to settle a dispute by discussion for 30 days. If that fails, it will be settled by a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated at Noida, in English. Subject to that, the courts at Gautam Buddh Nagar, Uttar Pradesh have jurisdiction.</p>"),
 ("Changes to these terms", "<p>We may update these terms. Material changes are told to account owners at least 15 days in advance; continuing to use FinCom after that means you accept them.</p>"),
 ("Contact", f"<p>{CO}, {ADDRESS}. Email {EMAIL}. Phone {PHONE}. GSTIN {GSTIN}.</p>"),
])
write("terms.html", page("terms.html", "Terms of use: FinCom", "The terms for using FinCom, operated by Yuvnav Services Private Limited, Noida.", terms))

# ---------------- refunds and cancellation ----------------
refund = doc("Refunds and cancellation", f"""<p class="lead">FinCom is a subscription software service provided online by <b>{CO}</b>. This policy explains how payments, cancellations and refunds work.</p>""", [
 ("How you pay", "<p>Plans and use are paid from a prepaid credit balance. Each payment is acknowledged with a GST tax invoice. The monthly plan fee is taken from the balance on the first day of each month; per-use charges are taken as the service is used.</p>"),
 ("Cancelling", "<p>You can cancel at any time from Help inside FinCom or by writing to us. The plan then stops at the end of the current month and no further monthly fee is taken. The current month's fee is not refunded pro rata.</p>"),
 ("When credit is refunded", f"""<ul><li><b>A payment made twice by mistake:</b> refunded in full.</li>
<li><b>A reading that failed:</b> the charge for an AI or OCR reading that did not complete goes back to your credit automatically.</li>
<li><b>Account closed by us</b> for reasons other than a breach of the terms: unused credit is refunded.</li>
<li><b>Closing your own account:</b> unused credit added in the last 90 days is refunded on request, less any charges already used.</li></ul>
<p>Otherwise, credit already added is not refunded and does not expire while the account is open.</p>"""),
 ("How refunds are made", f"<p>Ask by writing to {EMAIL} with your firm name and the payment details. Approved refunds are made to the original payment account within 7 working days of approval. A credit note is issued for the GST.</p>"),
 ("Delivery of the service", "<p>FinCom is delivered online. Access starts when your account is opened and credit is added; nothing is shipped physically. If you cannot get access after paying, write to us and we will resolve it within one working day.</p>"),
 ("Contact", f"<p>{CO}, {ADDRESS}. Email {EMAIL}. Phone {PHONE}.</p>"),
])
write("refund.html", page("refund.html", "Refunds and cancellation: FinCom", "How payments, cancellation and refunds work for FinCom.", refund))

# ---------------- data processing terms ----------------
dpa = doc("Data processing terms", f"""<p class="lead">These terms form part of the <a href="terms.html">terms of use</a>. They apply where <b>{CO}</b> processes personal data on behalf of a firm or business using FinCom (the "Customer"), under the Digital Personal Data Protection Act, 2023. The Customer is the Data Fiduciary; Yuvnav is the Data Processor.</p>""", [
 ("What we process", "<p>Personal data contained in the documents and records the Customer uploads or reads into FinCom, such as names, PAN, GSTIN, addresses, bank transactions and salary figures of the Customer's clients, suppliers, customers and staff.</p>"),
 ("Only on your instructions", "<p>We process this data only to provide FinCom as the Customer uses and configures it, and for no other purpose. We do not sell it, use it to train AI models, or use it for marketing.</p>"),
 ("Our people", "<p>Only staff who need access to provide support or run the service may access Customer data, and they are bound by confidentiality. Access by us is recorded.</p>"),
 ("Security", "<p>We keep the measures described on our <a href=\"security.html\">security page</a> in place, including isolation of each Customer's data by the database, encryption at rest and in transit, backups, an audit trail that cannot be edited, and a documented incident process.</p>"),
 ("Sub-processors", "<p>The Customer agrees to the sub-processors listed on our security page. We tell account owners at least 15 days before adding or replacing one; the Customer may object and, if we cannot resolve the objection, close the account with a refund of unused credit.</p>"),
 ("Helping you meet your duties", "<p>We help the Customer respond to requests from data principals (access, correction, erasure) and to meet its obligations on security and breach notification, taking into account what we can reasonably do.</p>"),
 ("Personal data breach", "<p>We tell the Customer without undue delay, and in any case within 24 hours of confirming a breach affecting its data, with the facts known at the time, and keep the Customer informed as we learn more. We report to CERT-In within 6 hours as required.</p>"),
 ("End of the service", "<p>When the account closes, the Customer can export its data for 30 days. We then delete it within 90 days, including from backups within a further 14 days, unless the law requires us to keep it.</p>"),
 ("Information and audits", "<p>On request, and under confidentiality, we share our ISO 27001 documentation, VAPT summary and answers to reasonable security questionnaires. Audits beyond that are by agreement, at the Customer's cost, once a year.</p>"),
])
write("dpa.html", page("dpa.html", "Data processing terms: FinCom", "Data processing terms between FinCom customers and Yuvnav Services Private Limited under the DPDP Act 2023.", dpa))

# ---------------- contact ----------------
contact = f"""<main id="main" class="contact">
  <section class="p-hero"><div class="wrap">
    <h1>Contact us.</h1>
    <p class="lede-2">For help with FinCom, the quickest way is Help inside the app. You can also reach us here.</p>
  </div></section>
  <section><div class="wrap cgrid">
    <div class="cbox">{icon("buildings")}<h2>{CO}</h2><p>{ADDRESS}</p><p class="small">CIN {CIN}<br>GSTIN {GSTIN}</p></div>
    <div class="cbox">{icon("envelope-simple")}<h2>Support and sales</h2><p>Email {EMAIL}</p><p>Phone {PHONE}</p><p class="small">Monday to Saturday, 10 am to 6 pm India time, except public holidays.</p></div>
    <div class="cbox">{icon("scales")}<h2>Grievance Officer</h2><p>{GRIEVANCE}</p><p>Email {PRIV_EMAIL}</p><p class="small">Under the DPDP Act 2023 and the IT Act 2000. Complaints are acknowledged within 48 hours and resolved within 30 days.</p></div>
    <div class="cbox">{icon("shield-check")}<h2>Security</h2><p>Report a security issue privately through our <a href="security.html#disclose">disclosure process</a>.</p><p class="small">For an urgent incident affecting your firm, email {EMAIL} with "URGENT" in the subject.</p></div>
  </div></section>
</main>"""
write("contact.html", page("contact.html", "Contact and grievances: FinCom", "Contact FinCom and Yuvnav Services Private Limited, Noida, including the Grievance Officer.", contact))
