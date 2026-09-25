# Setting up TDS Desk

## 1. Working on the code

1. Clone `caanshulgarg/testingtdsdesk`. The source is in `src/`; the site files at the top of the repository are the last test build.
2. Edit files in `src/js`, `src/css` or `src/shell.html`. A new program file goes into `src/js/ORDER.json` where it belongs; `build.py` refuses a file that is not listed.
3. Build: `python3 build.py`. This writes `site/` (live) and `site-test/` (test), each with its `assets/`.
4. Run the tests (see `docs/testing.md`).
5. Release to test: copy `site-test/index.html` to the top of the repository as `index.html`, commit, push. GitHub Pages publishes it in about a minute at `caanshulgarg.github.io/testingtdsdesk/`.
6. Check it for about five minutes against the ZZ TEST company in Tally.
7. Release to live: copy `site/index.html` to `index.html` in `caanshulgarg/tds-desk`, commit with the same build number, push. The live build must come from the same source commit as the test build that was checked.

Keep `APP_VERSION` in `src/js/00-core.js` current: date, build number, and a short description. The test build adds `TEST · ` in front.

## 2. The Tally Bridge on the Tally server

1. Sign in to the server as the Windows user who runs Tally.
2. In TallyPrime: **F1 Help → Settings → Connectivity**, set **TallyPrime acts as** to *Both* (or *Server*) and the port to 9000.
3. In TDS Desk: **Settings → Tally Bridge → download the setup**. On the server, double-click `Setup-TDS-Bridge.bat` and press **I**. It installs into `%LOCALAPPDATA%\TDS Desk Bridge` and starts with Windows.
4. Copy the key from the bridge window into **Settings → Tally Bridge** in TDS Desk. The screen should show the bridge version (1.10.0) and the open companies.
5. **Reading straight from Tally:** a client's **From Tally** tab → *Read from Tally* for a period.
6. **The nightly copy:** **From Tally → Every night → Copy every night** (default 02:00). The companies must be open in that user's Tally at that time. In the morning, **See last night's copy → Use it**.
7. **The FVU:** install Java and Protean's File Validation Utility on the same computer. Put the path of `FVU_STANDALONE.jar` (and the CSI file, if used) in the client's settings; then **TDS → the quarter → Check it with the FVU**.

Changing the bridge: edit `bridge/additions.ps1`, rebuild with `python3 bridge/merge.py bridge/TDSBridge-1.8.1-base.ps1 bridge/TDSBridge.ps1`, run `pwsh bridge/ps5check.ps1 -File bridge/TDSBridge.ps1` and the bridge tests, and raise `$BridgeVersion`. To hand it out, put the script into the setup file (the text after `::PS1BEGIN::` is the script in base64, 120 characters to a line) and save the whole setup file, base64-encoded, as `assets/bridge-setup.txt`.

## 3. Supabase

| | Live | Staging |
|---|---|---|
| Project | `nrtczucrlgalvtojwoes` | `qbocskaiewaxqcvaunzc` (`tds-desk-staging`, ap-south-1) |
| Used by | the live site | meant for the test site |

Staging has the live schema (14 migrations), the nightly backup, the `client-docs` and `doc-inbox` buckets, the `gateway`, `admin` and `signup` functions, and a firm called **ZZ TEST**. To finish it:

1. **Sign-in addresses:** Supabase dashboard → staging → **Authentication → URL Configuration**. Site URL `https://caanshulgarg.github.io/testingtdsdesk/`; add redirect URLs `https://caanshulgarg.github.io/testingtdsdesk/**` and `https://caanshulgarg.github.io/tds-desk/**`. Do the same on live for the live site.
2. **A superadmin:** sign up once on staging, then in the SQL editor: `insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';`
3. **Keys for paid services:** as superadmin in TDS Desk, set `claude_api_key` and `google_vision_key`, or leave them unset on staging so no paid call can be made from test.
4. **Point the test site at staging:** the Supabase address and public key in the test build must be staging's. Do this only after steps 1 and 2, or sign-in on the test site stops working.

A migration goes to staging first, is checked with the test site, and only then to live, with the same file.
