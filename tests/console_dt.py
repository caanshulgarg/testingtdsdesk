"""Helpers for the console's DataTable column-header filters (console/src/ui/DataTable.jsx), shared by the
run_console_*_ui.py tests. A filterable column's header has a filter button [data-colf=<key>]; it opens a pop-up
.colpop[data-colpop=<key>] (role=dialog) with the column's filter: a search box and a checklist (select), a box
(text), From / To (number, date), Any / Yes / No (bool); Apply, Clear, Cancel. Columns that are a filter only (not a
column of the table) are under the header's "More filters" button [data-colf=_more]. An active filter marks its
header (th[data-filtered], the button .on, filled); "Clear filters" [data-testid=clear-filters] above the table."""


def open_col(pg, table, col):
    pg.click("[data-table=%s] [data-colf='%s']" % (table, col))
    pg.wait_for_selector("[data-table=%s] .colpop[data-colpop='%s']" % (table, col))


def apply_col(pg, table):
    pg.click("[data-table=%s] .colpop [data-cp=apply]" % table)
    pg.wait_for_selector("[data-table=%s] .colpop" % table, state="detached")


def pick(pg, table, col, *values, more=False):
    """Tick these values of a select column's checklist (only these) and apply."""
    open_col(pg, table, "_more" if more else col)
    for b in pg.query_selector_all("[data-table=%s] .colpop input[data-filter^='%s:']" % (table, col)):
        v = b.get_attribute("data-filter").split(":", 1)[1]
        if (v in values) != b.is_checked(): b.click()
    apply_col(pg, table)


def clear_filters(pg, table):
    pg.click("[data-table=%s] [data-testid=clear-filters]" % table)


def marked(pg, table):
    """The keys of the columns whose header is marked as filtered (and "_more" when a filter-only column is on)."""
    return pg.eval_on_selector_all("[data-table=%s] thead [data-colf].on" % table, "els => els.map(e => e.dataset.colf)")
