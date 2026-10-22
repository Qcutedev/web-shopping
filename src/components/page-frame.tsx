import type { ReactNode } from "react";

/**
 * Frame of a customer page with one `h1` and a description. The `main` landmark comes from the
 * shell.
 */
export function PageFrame({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="container-page flex flex-1 flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="type-page-title">{heading}</h1>
        {description ? <p className="type-body text-foreground-secondary">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}
