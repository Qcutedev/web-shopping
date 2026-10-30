"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { buttonVariants } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { signOut } from "@/lib/api-client/auth";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const ITEM =
  "type-label text-foreground hover:bg-surface-muted focus-ring flex min-h-11 w-full items-center rounded-sm px-3 text-left disabled:cursor-not-allowed disabled:text-foreground-disabled";

/**
 * Signed-in menu of the storefront header: the user's name as a disclosure button, a link to the
 * account and to the orders, and sign-out. The name is shown only; the server decides everything
 * the links lead to. Links are the same for every role except one: an admin also gets a link to
 * `/admin` (display only; every admin page and endpoint checks the role again on the server).
 *
 * Sign-out posts to `/api/v1/auth/sign-out`, disables itself while pending, and on success (or a
 * `401`, which means the session was already gone) goes home and refreshes the server data.
 */
export function AccountMenu({ name, isAdmin = false }: { name: string | null; isAdmin?: boolean }) {
  const router = useRouter();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Every way to close the menu goes through here so a stale sign-out error never reappears. */
  function close() {
    setOpen(false);
    setFailed(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        toggle.current?.focus();
      }
    }
    function onPointer(event: PointerEvent) {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function onSignOut() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    const result = await signOut();
    if (result.ok || result.status === 401) {
      router.replace(ROUTES.home);
      router.refresh();
      return;
    }
    setPending(false);
    setFailed(true);
  }

  const visible = name ?? th.shell.header.account.fallbackName;
  const label =
    name === null
      ? th.shell.header.account.fallbackName
      : fill(th.shell.header.account.buttonLabel, { name });

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(buttonVariants({ variant: "ghost" }), "max-w-40 sm:max-w-56")}
      >
        <span className={cn(USER_NAME_CONTAINER_CLASS, "truncate")}>
          {name === null ? visible : <UserName>{visible}</UserName>}
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="border-border bg-surface absolute end-0 top-full z-40 mt-1 flex w-56 flex-col gap-1 rounded-md border p-2 shadow-md"
      >
        <Link href={ROUTES.account} className={ITEM} onClick={close}>
          {th.shell.header.account.profile}
        </Link>
        <Link href={ROUTES.orders} className={ITEM} onClick={close}>
          {th.shell.header.account.orders}
        </Link>
        {isAdmin ? (
          <Link href={ROUTES.admin} className={ITEM} onClick={close}>
            {th.shell.header.account.admin}
          </Link>
        ) : null}
        <button type="button" className={ITEM} disabled={pending} onClick={onSignOut}>
          {pending ? th.shell.header.account.signingOut : th.shell.header.account.signOut}
        </button>
        {failed ? (
          <p role="alert" className="type-caption text-danger px-3 py-1">
            {th.shell.header.account.signOutFailed}
          </p>
        ) : null}
      </div>
    </div>
  );
}
