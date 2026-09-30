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
| Shared pieces: boxes, ledger lists, column headings | `src/parts/CommitBox.jsx`, `LedgerBox.jsx`, `LedgerSelect.jsx`, `ColHead.jsx` |
| GSTR-2B from the portal | `src/screens/GstApiCard.jsx` |
