import { getSettings } from "@/modules/admin";
import { ADMIN_ROUTES } from "./routes";
import { SettingsForm } from "./settings-form";
import { renderForAdmin } from "./with-admin";

/** Server Component: the settings row through the module service, handed to the form. */
export async function SettingsSection() {
  return renderForAdmin(ADMIN_ROUTES.settings, async (actor) => {
    const settings = await getSettings(actor);
    return <SettingsForm settings={settings} />;
  });
}
