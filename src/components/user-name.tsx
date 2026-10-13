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
