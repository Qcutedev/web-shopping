"use client";

import Link from "next/link";
import { useRef } from "react";
import { CategoryIcon } from "@/components/catalog/category-icon";
import { ChevronRightIcon, CloseIcon } from "@/components/ui/icons";
import { th } from "@/i18n/th";
import { categoryHref, ROUTES } from "@/lib/routes";

export interface DrawerCategory {
  id: string;
  name: string;
  slug: string;
}

const ROW =
  "focus-ring text-foreground hover:bg-surface-muted hover:text-primary flex min-h-11 items-center gap-3 rounded-md px-3 transition-colors duration-150";

/**
 * Hamburger button in the header and the left panel it opens. The panel is a native modal
 * `dialog`, so the browser traps focus, closes on Escape and returns focus to the button.
 */
export function CategoryDrawer({ categories }: { categories: readonly DrawerCategory[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { menu } = th.shell.header;
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        aria-label={menu.open}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
        className="focus-ring text-foreground hover:bg-surface-muted inline-flex size-11 items-center justify-center rounded-md transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
          className="size-6"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        aria-label={th.catalog.home.menuTitle}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="drawer-panel bg-surface text-foreground m-0 h-dvh max-h-none w-[min(20rem,88vw)] overflow-y-auto p-0 shadow-xl backdrop:bg-black/40"
      >
        <div className="border-border bg-surface sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2">
          <p className="type-panel-title">{th.catalog.home.menuTitle}</p>
          <button
            type="button"
            aria-label={menu.close}
            onClick={close}
            className="focus-ring hover:bg-surface-muted inline-flex size-11 items-center justify-center rounded-md"
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label={th.catalog.home.menuTitle} className="flex flex-col gap-4 p-3">
          <ul>
            <li>
              <Link href={ROUTES.home} onClick={close} className={ROW}>
                <span className="type-small flex-1">{th.shell.header.home}</span>
              </Link>
            </li>
            <li>
              <Link href={ROUTES.search} onClick={close} className={ROW}>
                <span className="type-small flex-1">{th.catalog.home.menuAllProducts}</span>
              </Link>
            </li>
            <li>
              <Link href={`${ROUTES.search}?sort=price_asc`} onClick={close} className={ROW}>
                <span className="type-small flex-1">{menu.cheapest}</span>
              </Link>
            </li>
          </ul>
          {categories.length > 0 ? (
            <div>
              <p className="type-label text-foreground-muted px-3 py-2">{menu.categories}</p>
              <ul>
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link href={categoryHref(category.slug)} onClick={close} className={ROW}>
                      <CategoryIcon name={category.name} className="size-5 shrink-0" />
                      <span className="type-small line-clamp-1 flex-1">{category.name}</span>
                      <ChevronRightIcon className="text-foreground-muted size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="border-border border-t pt-3">
            <li>
              <Link href={ROUTES.openStore} onClick={close} className={ROW}>
                <span className="type-small flex-1">{th.shell.header.openStore}</span>
              </Link>
            </li>
            <li>
              <Link href={ROUTES.cart} onClick={close} className={ROW}>
                <span className="type-small flex-1">{menu.cart}</span>
              </Link>
            </li>
          </ul>
        </nav>
      </dialog>
    </>
  );
}
