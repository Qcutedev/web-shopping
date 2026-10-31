"use client";

import { useEffect, useState } from "react";
import { th } from "@/i18n/th";

const SHOW_AFTER_PX = 600;

/** Round button at the bottom corner that scrolls to the top. It appears after some scrolling. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label={th.shell.backToTop}
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      data-visible={visible}
      className="back-to-top focus-ring bg-ink text-on-ink hover:bg-ink-hover fixed right-4 bottom-4 z-40 flex size-12 items-center justify-center rounded-full shadow-lg"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12l5-5 5 5" />
      </svg>
    </button>
  );
}
