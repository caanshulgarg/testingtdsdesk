// Settings (Owner only): a stub. The billing module fills it: platform defaults such as trial credit, the low-credit
// warning and grace days, read by the server from a settings table (its migration takes a number from 119-123).
import { Settings as Cog } from "lucide-react";
import { ErrorNote, Loading, Page } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";

function Settings() {
  const { loading, data, error, reload } = useAction("settings.get");
  return (
    <Page title="Settings" sub="Platform defaults for every firm. Only an owner can change them.">
      <ErrorNote error={error} onRetry={reload} />
      {loading && <Loading />}
      {data && !data.ready && <div className="card"><p>Coming with the billing module: trial credit, the low-credit warning, grace days and other platform defaults, changed here without code.</p></div>}
    </Page>
  );
}
export const module = { id: "settings", label: "Settings", icon: Cog, action: "settings.get", routes: [{ path: /^settings$/, render: () => <Settings /> }] };
