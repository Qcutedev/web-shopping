/**
 * Quoting for the few statements of the harness that cannot use bound parameters: a table, a
 * sequence, or a database name cannot be a parameter, and neither can a literal inside a
 * statement that is built as one `UNION ALL` over many tables.
 *
 * The names quoted with these come from the database catalogue or from the validated test
 * database name, never from a request. Pure functions; no database layer.
 */

function assertNoNul(value: string): void {
  if (value.includes("\u0000")) {
    throw new Error("A SQL identifier or literal cannot contain a NUL character.");
  }
}

/** `name` as a quoted SQL identifier: `"name"`, with every `"` inside doubled. */
export function quoteIdentifier(name: string): string {
  assertNoNul(name);
  if (name === "") {
    throw new Error("A SQL identifier cannot be empty.");
  }
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * `value` as a SQL string literal: `'value'`, with every `'` inside doubled. Correct for
 * `standard_conforming_strings = on`, the PostgreSQL default, under which a backslash is an
 * ordinary character.
 */
export function quoteLiteral(value: string): string {
  assertNoNul(value);
  return `'${value.replaceAll("'", "''")}'`;
}
