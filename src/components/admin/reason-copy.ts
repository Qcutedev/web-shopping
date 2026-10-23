import { th } from "@/i18n/th";

/** Thai copy for a refused reason: empty, over the limit, or any other rule not met. */
export function messageForCode(code: string): string {
  const copy = th.admin.common.reasonErrors;
  if (code === "too_small") return copy.required;
  if (code === "too_big") return copy.tooLong;
  return copy.invalid;
}
