Made-up portal files for the Income Tax Return module's tests (tests/run_itr_*.mjs, run_itr_ui.py). Every name, PAN,
TAN, GSTIN, UAN, establishment code and amount here is invented. The layouts follow the portals' published
descriptions (AIS / TIS: compliance portal; 26AS: TRACES "Export as Text"; pre-filled data: e-filing portal; ECR:
EPFO's upload format; challans: EPFO and ESIC receipts) and are read by field names: see app/src/lib/itr/imports.js.
Never put a real client's file here: the owner's files go to the firm's private storage only.
