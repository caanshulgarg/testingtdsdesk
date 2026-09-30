# FinCom — the React app: a guide for developers

Start here if you are new to the code. Fifteen minutes with this page and one screen file should be enough to
change a screen safely.

More: `docs/architecture.md` (the whole system: Tally Bridge, Supabase, reading bills), `docs/react-migration.md`
(which screens are React yet), `docs/testing.md`.

## What FinCom does, in one paragraph

A CA firm keeps many clients. For each client, bills, bank statements and sales come in (**Collect**), are read and
checked — TDS, GST, the Tally ledgers (**Review**) — then posted into the client's company in TallyPrime (**Post**),
and kept on record (**Done**). The sidebar steps follow that order.

## Two halves

| | Where | What |
|---|---|---|
| **Business logic** | `src/js/*.js` (repo root) | Tax rules, reading bills, Tally, the firm account, storage. Plain scripts, numbered in load order, built into `app/legacy/legacy.js` by `python3 build.py --react`. Their functions and objects are globals. |
| **Screens** | `app/src/` | React. Screens read the state and call the business logic's functions. |

The screens not yet moved are still HTML strings made by `view…()` functions in `src/js`; see
`docs/react-migration.md`.

## The globals a screen uses

| Name | What it is |
|---|---|
| `S` | The one state object (open client, tab, filters, what is selected…). `src/js/00-core.js` lists every key. |
| `CO()` / `D()` | The open client, and its data: `D().entries` (bills by id), `D().parties` (suppliers). |
| `render()` | Draws everything again. Call it after changing `S` or a client's data. |
| `doAct("name")` | The actions behind buttons (`approve`, `billPost`, `revApprove`…): the `switch` in `src/js/27-firm-account.js`. Search for `case "name"`. |
| `compute(e)` | Everything worked out for a bill: TDS, section, GST, the Tally lines, what is missing. |
| `Store` | Saves: `Store.saveEntry(cid, e)`, `Store.saveParty(cid, p)`, `Store.saveCompany(co)`. |
| `money()`, `money0()`, `INR`, `fmtDate()`, `num()` | Formatting and safe numbers. |

## How one screen works

Take `src/screens/Parties.jsx` (a client's suppliers):

1. The old code puts a placeholder where the screen goes: `viewParties()` returns `<div data-react="Parties"></div>`.
2. `src/screens/index.js` maps the name `Parties` to the component.
3. `src/store.js` puts the component there on every `render()`, keeping it (and what is typed in it) between redraws.
   Other `data-*` attributes on the placeholder become props.
4. The component reads `S`, `D()`, … and its buttons call functions: `onClick={() => doAct("addParty")}`.

Every screen file starts with a comment saying what it shows and which old function it replaced.

## Tables

A `<table className="bk-table">` gets the funnels on its headings (filter any column) and scrolls in its own box when
long, as the old tables did: `GridF` (`src/js/31-grid-filters.js`) adds them after each redraw. Add `gf-off` only to a
table with its own filters or a single figure per row group.

## Keys in lists

Every row in a list needs a key no other row has. Supplier, bill and document keys can repeat (two lines for one bill),
so add the position: `key={x.key + ":" + i}`. A repeated key leaves old rows on screen when a list is filtered. The page
comparisons (`tests/pages_gst.py`, `pages_tds.py`) run on a development build report any repeated key as an error:
`NODE_ENV=development npx vite build --mode test --outDir /tmp/dist-dev`.

## Printing a screen

`FinComReact.markup("Gst9c")` (in `src/main.jsx`) gives a React screen as plain HTML, for a PDF made from what is on
screen. Add a screen to `PRINTABLE` there to print it the same way.

## Rules of the house

- **Change state, then `render()`.** There is no other store; React redraws from `S`.
- **Logic stays out of screens.** If a button does more than a line or two, the work goes in a named function in
  `src/js` (`billDelete`, `billBack`, `goDocType`), which old and new screens can both call.
- **Names say what they do**, in words a CA would use; comments say *why*, not *what*.
- **Money is worked out by `compute()`**, never again in a screen, so every screen shows the same figure.
- **One test per screen** in `tests/run_react_*.py`, written as a checklist a user would recognise. Run it with
  the testing build before you commit.

## Run it

```
python3 build.py --react         # business logic → app/legacy
cd app && npm install
npm run dev                      # local
npm run build:test               # app/dist-test: the testing site (staging database)
cd ../tests && TDSDESK_SITE=../app/dist-test python3 run_react_post.py
```

## Find your way

| Screen | File |
|---|---|
| Sidebar, top bar, client switcher | `src/Side.jsx`, `src/TopBar.jsx`, `src/Switcher.jsx` |
| Home: clients, today, inbox | `src/screens/Clients.jsx`, `Today.jsx`, `InboxAll.jsx` |
| Collect (uploads, reading) | `src/screens/Collect.jsx`, `src/parts/*` |
| Purchase bills: list, one bill | `src/screens/Invoices.jsx`, `Bill.jsx` |
| Review table, drawer, bottom bars | `src/screens/Review.jsx` |
| Suppliers and TDS | `src/screens/Parties.jsx` |
| Post to Tally, Done, post log | `src/screens/Post.jsx`, `Done.jsx` |
| Bank statement: lines, tabs, bar | `src/screens/Bank.jsx`, `src/parts/LedgerBox.jsx` |
| Settings (firm) and Client setup | `src/screens/Settings.jsx` |
| Sales: list, an invoice, creating one, settings | `src/screens/Sales.jsx` |
| A client's dashboard; Transactions | `src/screens/Dash.jsx`, `Txn.jsx` |
| The books (TDS & GST tabs); TDS by year and quarter | `src/screens/Books.jsx` |
| A TDS return (26Q, 24Q) and certificates | `src/screens/TdsReturn.jsx` |
| The GST tab; GSTR-1 and 3B; the input register; 2B (other parts are still old pages) | `src/screens/Gst.jsx`, `src/screens/gst/Returns.jsx`, `gst/InputRegister.jsx`, `gst/TwoB.jsx` (2B reconciliation), `gst/Workings.jsx` (amendments, advances, reversal), `gst/Annual.jsx` (GSTR-9, 9C), `gst/ItcFollow.jsx`, `gst/ReturnsFiled.jsx`, `gst/Periodic.jsx` (QRMP, CMP-08, GSTR-4), `gst/Filing.jsx` (filing, GSTR-1A) |
| A filter bar (find box, choices, print, Excel) | `src/parts/FilterBar.jsx` |
| Shared pieces: boxes, ledger lists, column headings | `src/parts/CommitBox.jsx`, `LedgerBox.jsx`, `LedgerSelect.jsx`, `ColHead.jsx` |
| GSTR-2B from the portal | `src/screens/GstApiCard.jsx` |
