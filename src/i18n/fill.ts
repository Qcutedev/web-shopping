/**
 * Fills the `{name}` placeholders of a Thai string from `src/i18n/th.ts`, for example
 * `fill(th.quantity.lowered, { available: 4 })`. Every occurrence of a name is replaced.
 *
 * A placeholder without a value, or a value that is not a finite whole number or a string, throws:
 * a message that shows "{available}" to a customer is a bug that should fail in a test.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`fill: no value for the placeholder {${name}}`);
    }
    const value = values[name];
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError(`fill: the value for {${name}} is not a finite number`);
    }
    return String(value);
  });
}
