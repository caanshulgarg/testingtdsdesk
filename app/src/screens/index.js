// The screens already in React, by the name the old screens use to place them (<div data-react="Name" data-…>).
import GstApiCard from "./GstApiCard.jsx";
import Today from "./Today.jsx";
import InboxAll from "./InboxAll.jsx";
import Clients from "./Clients.jsx";
import Collect from "./Collect.jsx";
import Invoices from "./Invoices.jsx";
import BillDetail from "./Bill.jsx";
import { ReviewTable, ActionBar, Drawer } from "./Review.jsx";
import Parties from "./Parties.jsx";
import { PostStep, Export } from "./Post.jsx";
import { DoneStep, PostLog } from "./Done.jsx";
import Bank, { BankBar } from "./Bank.jsx";
import { FirmSettings, ClientSetup } from "./Settings.jsx";
import Sales, { SalesBar } from "./Sales.jsx";
import Txn from "./Txn.jsx";
import Dash from "./Dash.jsx";
import Books from "./Books.jsx";
import DocqPanel from "../parts/Docq.jsx";
import Unsorted from "../parts/Unsorted.jsx";
import UploadBlock from "../parts/UploadBlock.jsx";
import { Jobs, ReadingCheck, UploadOptions, Working } from "../parts/Reading.jsx";

export default { GstApiCard, Today, InboxAll, Clients, Collect, Invoices, BillDetail, ReviewTable, ActionBar, Drawer, Parties, PostStep, Export, DoneStep, PostLog, Bank, BankBar, FirmSettings, ClientSetup, Sales, SalesBar, Txn, Dash, Books, DocqPanel, Unsorted, UploadBlock, Jobs, ReadingCheck, UploadOptions, Working };
