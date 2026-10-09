// The card on Reports, Look up and Letters when no books are read yet (Arc's EmptyState). Was FC.noBooks (src/js/44).
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { BookOpen } from "lucide-react";
import Button from "./Button.jsx";

export default function NoBooks({ what }) {
  const live = typeof bridgeLive === "function" && bridgeLive(CO());
  return <div className="fc-empty arc-empty">
    <EmptyState title={what + " needs the books"} description="Read the day book and balances from Tally first. It takes a minute a month through FinCom Bridge."
      icon={<BookOpen width={22} height={22} strokeWidth={1.5} />}
      action={<><Button className="btn primary" onClick={() => FC.go("import")}>Read the books from Tally</Button>{!live && <Button className="btn" onClick={() => doAct("tallyGuide")}>Set up FinCom Bridge</Button>}</>} />
  </div>;
}
