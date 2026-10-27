// Settings (Owner only): platform defaults, one section per module. Billing (migration 119): the starting credit, the
// low-credit warning, the grace and paused-after days, trial days.
import { Settings as Cog } from "lucide-react";
import { ErrorNote, Loading, Page } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { BillingSettings } from "../billing/settings.jsx";

function Settings({ me }) {
  const { loading, data, error, reload } = useAction("settings.get");
  return (
    <Page title="Settings" sub="Platform defaults for every firm. Only an owner can change them.">
      <ErrorNote error={error} onRetry={reload} />
      {loading && <Loading />}
      {me.actions.includes("settings.billing.get") && <BillingSettings me={me} />}
    </Page>
  );
}
export const module = { id: "settings", label: "Settings", icon: Cog, action: "settings.get", routes: [{ path: /^settings$/, render: (_, me) => <Settings me={me} /> }] };
