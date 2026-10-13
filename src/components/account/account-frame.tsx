import type { ReactNode } from "react";
import { type AccountPage, AccountNav } from "./account-nav";

/**
 * Frame of an account page: title, description, the account links, then the content. The `main`
 * landmark comes from the shell; this renders the page's single `h1`.
 */
export function AccountFrame({
  current,
  title,
  description,
  children,
}: {
  current: AccountPage;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="container-page flex flex-1 flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="type-page-title">{title}</h1>
        <p className="type-body text-foreground-secondary">{description}</p>
      </header>
      <AccountNav current={current} />
      {children}
    </div>
  );
}
