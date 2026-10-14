/**
 * The class name or code of a thrown value, for a log line that must not carry the error's text
 * (SECURITY.md SR-04: a database error's message can hold a row's names, phones, addresses).
 * Returns the value only when it is a short label of safe characters, else undefined.
 */
export function errorLabel(error: unknown, key: "name" | "code"): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && /^[A-Za-z0-9_.$-]{1,64}$/.test(value) ? value : undefined;
}
