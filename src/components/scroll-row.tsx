"use client";

import { type ReactNode, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

const ARROW =
  "focus-ring border-border-contrast bg-surface text-foreground hover:border-control-border-hover absolute top-1/3 z-10 hidden size-11 items-center justify-center rounded-full border shadow-md md:flex";

/**
 * A row that scrolls sideways with snap points. The arrows are a convenience for the pointer;
 * the row itself scrolls by touch, wheel, and keyboard (every item is a link, so Tab reaches
 * each one and the browser scrolls it into view).
 */
export function ScrollRow({
  label,
  previous,
  next,
  children,
}: {
  label: string;
  previous: string;
  next: string;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  function scrollBy(direction: 1 | -1) {
    const list = listRef.current;
    if (list === null) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior });
  }

  return (
    <div className="relative">
      <ul
        ref={listRef}
        aria-label={label}
        className="scroll-row -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-1 pb-3 md:gap-4"
      >
        {children}
      </ul>
      <button
        type="button"
        aria-label={previous}
        onClick={() => scrollBy(-1)}
        className={`${ARROW} -left-3`}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        aria-label={next}
        onClick={() => scrollBy(1)}
        className={`${ARROW} -right-3`}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/** One item of a `ScrollRow`: fixed width so several are visible and the rest peek in. */
export function ScrollRowItem({ children }: { children: ReactNode }) {
  return <li className="w-40 shrink-0 snap-start sm:w-48 lg:w-56">{children}</li>;
}
