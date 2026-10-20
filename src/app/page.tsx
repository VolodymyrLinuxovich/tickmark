import { getSource } from "@/lib/ramp/source";
import { TopBar } from "./topbar";
import Workbench from "./workbench";


export default function Page() {
  const info = getSource().info;
  return (
    <>
      <TopBar info={info} />
      <Workbench source={info} claude={!!process.env.ANTHROPIC_API_KEY && process.env.TICKMARK_PARSER !== "rules"} />
      <footer className="foot wrap">
        Tickmark reads Ramp through the Developer API (transactions, receipts, approvals, bills, vendors, users) with read scopes, and writes only comments you approve.
      </footer>
    </>
  );
}
