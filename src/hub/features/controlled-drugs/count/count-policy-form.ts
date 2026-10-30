import { parseCountPolicySettings, type CountPolicyRole, type CountPolicySettings } from "./count-admin-schema.ts";

export const countPolicyFlags = ["observation_enabled", "management_enabled", "read_enabled", "reconciliation_enabled"] as const;
export const countPolicyRoleFields = ["observer_roles", "manager_roles", "reader_roles", "reconciliation_preparer_roles", "reconciliation_approver_roles", "reconciliation_executor_roles", "reconciliation_confirmer_roles", "reconciliation_resolver_roles"] as const;
export const countPolicyAges = ["max_observation_age_seconds", "max_reconciliation_preparation_age_seconds", "max_reconciliation_approval_age_seconds", "max_reconciliation_confirmation_age_seconds"] as const;
export const countPolicyTexts = ["meaning_text", "meaning_version", "reconciliation_meaning_text", "reconciliation_meaning_version"] as const;
export interface CountPolicyDraft {
  readonly flags: Readonly<Record<typeof countPolicyFlags[number], "" | "true" | "false">>;
  readonly roles: Readonly<Record<typeof countPolicyRoleFields[number], readonly CountPolicyRole[]>>;
  readonly ages: Readonly<Record<typeof countPolicyAges[number], string>>;
  readonly texts: Readonly<Record<typeof countPolicyTexts[number], string>>;
  readonly method: "" | "none" | "manual_count";
}
/** No clinical roles, time limits, meanings or enabled flags are preselected. */
export function countPolicyDraft(settings: CountPolicySettings | null): CountPolicyDraft {
  return {
    flags: Object.fromEntries(countPolicyFlags.map(key => [key, settings ? String(settings[key]) : ""])) as CountPolicyDraft["flags"],
    roles: Object.fromEntries(countPolicyRoleFields.map(key => [key, settings ? [...settings[key]] : []])) as unknown as CountPolicyDraft["roles"],
    ages: Object.fromEntries(countPolicyAges.map(key => [key, settings ? String(settings[key]) : ""])) as CountPolicyDraft["ages"],
    texts: Object.fromEntries(countPolicyTexts.map(key => [key, settings ? settings[key] : ""])) as CountPolicyDraft["texts"],
    method: settings ? settings.methods.length ? "manual_count" : "none" : "",
  };
}
export function countPolicySettingsFromDraft(draft: CountPolicyDraft): CountPolicySettings {
  const flags = Object.fromEntries(countPolicyFlags.map(key => {
    if (draft.flags[key] !== "true" && draft.flags[key] !== "false") throw new Error("Choose enabled or disabled for every capability.");
    return [key, draft.flags[key] === "true"];
  }));
  const ages = Object.fromEntries(countPolicyAges.map(key => {
    if (!/^[1-9][0-9]{0,4}$/.test(draft.ages[key])) throw new Error("Enter every freshness limit as a positive whole number of seconds.");
    return [key, Number(draft.ages[key])];
  }));
  if (!draft.method) throw new Error("Choose the observation method, including none if disabled.");
  return parseCountPolicySettings({ ...flags, ...draft.roles, ...ages, ...draft.texts, methods: draft.method === "none" ? [] : ["manual_count"] });
}
