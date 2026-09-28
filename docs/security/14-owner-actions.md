# 14. Actions only the owner can take

In order of urgency. Each item takes minutes unless marked otherwise.

## This week
1. **Approve the live database fix** (F1: the money functions anyone could call). Reply "yes, apply to live". The same fix is tested on staging, and it changes only who may call what.
2. **Rotate the FYN relay key**, which was shown in a chat. Then rotate the Claude and Google keys used by the gateway (doc 10.3 has the steps).
3. **Two-step sign-in on the consoles.** For each of Supabase, GitHub, Google Cloud and Anthropic, confirm that two-step sign-in is on (Settings → Security in each).
4. **Supabase Auth settings.** Do these on live and on staging, under Authentication → Providers → Email and Authentication → Attack protection:
   - minimum password length 10;
   - leaked-password protection on;
   - bot protection (Cloudflare Turnstile is free);
   - "Confirm email" on for sign-up.
5. **Switch on Dependabot alerts** for both repositories (GitHub → Settings → Code security).
6. **Branch protection** on `caanshulgarg/tds-desk` → main: no force-push, and signed commits required.

## This month
7. **Sign the supplier agreements** (doc 9):
   - the Supabase DPA (Dashboard → Organization → Legal documents);
   - Anthropic's Commercial Terms and DPA;
   - the Google Cloud Data Processing Addendum (Console → IAM & Admin → Settings → Legal and compliance).
8. **Buy a code-signing certificate** for the bridge. Choose one of:
   - an OV certificate from Sectigo, DigiCert or SSL.com. This is about ₹25,000–40,000 a year, and needs a hardware token or a cloud signing service.
   - Azure Trusted Signing, if the firm qualifies. This is about US$10 a month.

   After purchase, I will add the signing step to `bridge/make_setup.py`.
9. **Choose the VAPT firm.** It must be CERT-In empanelled; get 3 quotes; the scope is in doc 12. Sign an NDA. Tell me when the test accounts are needed.
10. **Turn on point-in-time recovery for the live Supabase project**, and run the first restore test on staging (doc 8.3).
11. **Privacy notice for firms (DPDP).** Say what is collected, why, the suppliers and countries, how long data is kept, how to ask for deletion, and the grievance contact. I can draft it.

## Before the ISO Stage 1 audit (2–4 months)
12. Read, adjust and **approve docs 1–11**: sign, date and version them.
13. Name an **internal auditor**, for example an independent CA with ISO 27001 Lead Auditor training. Run one internal audit.
14. Hold a **management review** meeting and keep the minutes: objectives, risks, incidents, audit results, changes.
15. Hold one **incident tabletop exercise** (doc 7.8) and one **staff briefing** (doc 11.2).
16. Choose the **certification body**, accredited by NABCB or UKAS (for example BSI, TÜV SÜD, Intertek or TÜV India). Book Stage 1.
17. **Key-person cover:** a sealed note with a director; name a second developer or a support firm (risk R22).
