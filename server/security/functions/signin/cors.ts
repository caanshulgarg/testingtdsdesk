// The list of sites and headers lives in one place for every function: server/_shared/cors.ts (deployed as
// ../_shared/cors.ts; see server/_shared/README.md). The sign-in function also answers the FinCom Console's two sites:
// the console signs its people in here, as the app does.
import { CONSOLE_ORIGINS, corsFor as listed } from "../_shared/cors.ts";
export const corsFor = (req: Request | null) => listed(req, { also: CONSOLE_ORIGINS });
