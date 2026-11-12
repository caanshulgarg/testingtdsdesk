// The screens already in React, by the name the old screens use to place them (<div data-react="Name" data-…>).
// Stability batch 2: the screens of the first open (Today, Clients, the Overview, Purchase and its review, the reading
// cards) are in the app's own file; the others in files of their own, fetched when needed (lazy.js)
import { lazyModule } from "./lazy.js";
import Today from "./Today.jsx";
import InboxAll from "./InboxAll.jsx";
import Clients from "./Clients.jsx";
import Collect from "./Collect.jsx";
import Invoices from "./Invoices.jsx";
import BillDetail from "./Bill.jsx";
import { ReviewTable, ActionBar, Drawer } from "./Review.jsx";
import { DoneStep, PostLog } from "./Done.jsx";
import Dash from "./Dash.jsx";
import DocqPanel from "../parts/Docq.jsx";
import Unsorted from "../parts/Unsorted.jsx";
import UploadBlock from "../parts/UploadBlock.jsx";
import { Jobs, ReadingCheck, UploadOptions, Working } from "../parts/Reading.jsx";

const books = lazyModule(() => import("./Books.jsx")), gst = lazyModule(() => import("./Gst.jsx")), tally = lazyModule(() => import("./Tally.jsx"));
const settings = lazyModule(() => import("./Settings.jsx")), bank = lazyModule(() => import("./Bank.jsx")), sales = lazyModule(() => import("./Sales.jsx"));
const post = lazyModule(() => import("./Post.jsx")), help = lazyModule(() => import("./Help.jsx")), txn = lazyModule(() => import("./Txn.jsx"));
const parties = lazyModule(() => import("./Parties.jsx")), vendor = lazyModule(() => import("./VendorRecon.jsx")), compliance = lazyModule(() => import("./Compliance.jsx"));
const integ = lazyModule(() => import("./Integrations.jsx"));
// next-calls-meet (23-Oct-2026): Meetings (calls/Meetings.jsx; the call screen itself still loads only when a call opens)
const meet = lazyModule(() => import("../calls/Meetings.jsx"));
const apiCard = lazyModule(() => import("./GstApiCard.jsx")), apiAll = lazyModule(() => import("./GstApiAll.jsx")), filed = lazyModule(() => import("./gst/FiledCompare.jsx")), gfile = lazyModule(() => import("./gst/FileApi.jsx"));
const Books = books(), Gst = gst(), TallyHome = tally(), FirmSettings = settings("FirmSettings"), ClientSetup = settings("ClientSetup");
const Bank = bank(), BankBar = bank("BankBar"), Sales = sales(), SalesBar = sales("SalesBar"), PostStep = post("PostStep"), Export = post("Export");
const Help = help(), Txn = txn(), Parties = parties(), VendorRecon = vendor(), Compliance = compliance(), GstApiCard = apiCard(), GstApiAll = apiAll(), FiledCompare = filed(), GstFileApi = gfile(), Integrations = integ(), Meetings = meet();

export default { GstApiCard, GstApiAll, FiledCompare, GstFileApi, VendorRecon, Today, Compliance, InboxAll, Clients, Collect, Invoices, BillDetail, ReviewTable, ActionBar, Drawer, Parties, PostStep, Export, DoneStep, PostLog, Bank, BankBar, FirmSettings, ClientSetup, Sales, SalesBar, Txn, Dash, Books, Gst, TallyHome, Help, DocqPanel, Unsorted, UploadBlock, Jobs, ReadingCheck, UploadOptions, Working, Integrations, Meetings };
