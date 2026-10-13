import type { ReactNode } from "react";

/**
 * Renders text that a user typed (a display name, store name, address recipient) isolated for
 * bidirectional text, so that its direction cannot reorder the surrounding page (SEC-033, second
 * layer; the first layer refuses bidi control characters at the schema).
 *
 * Every screen that shows such a name must use this component, never a bare interpolation. React
 * escapes the text, so this is not an HTML escape; it is `<bdi>` isolation only.
 */
export function UserName({ children }: { children: ReactNode }) {
  return <bdi>{children}</bdi>;
}

/**
 * Classes for the container that holds a `UserName` (SEC-042, display part). The schema allows at
 * most 3 combining marks in a row, but a precomposed letter can still carry 5 or 6, so the
 * container clips: marks that would paint above or below it are cut. `min-w-0` and
 * `[overflow-wrap:anywhere]` keep a long unbroken name inside its parent. The `<bdi>` markup stays
 * bare because `tests/security` pins it.
 */
export const USER_NAME_CONTAINER_CLASS =
  "min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere]";
