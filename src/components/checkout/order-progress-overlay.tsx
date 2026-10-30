"use client";

import { th } from "@/i18n/th";

export type OrderProgressPhase = "processing" | "success" | "failed";

/**
 * Full-screen overlay shown while an order is placed: a spinner while the request runs, then an
 * animated check mark on success (or a cross when the mock payment was declined). The motion is
 * switched off for `prefers-reduced-motion` in globals.css; the text carries the same meaning.
 */
export function OrderProgressOverlay({ phase }: { phase: OrderProgressPhase }) {
  const text =
    phase === "processing"
      ? th.checkout.progressProcessing
      : phase === "success"
        ? th.checkout.progressSuccess
        : th.checkout.progressFailed;
  return (
    <div
      role="status"
      aria-live="polite"
      className="order-overlay bg-background/90 fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 backdrop-blur-sm"
    >
      {phase === "processing" ? (
        <span className="order-spinner" aria-hidden="true" />
      ) : (
        <svg
          viewBox="0 0 52 52"
          className="order-badge size-28"
          data-phase={phase}
          aria-hidden="true"
        >
          <circle className="order-badge-circle" cx="26" cy="26" r="24" fill="none" />
          {phase === "success" ? (
            <path className="order-badge-mark" fill="none" d="M14 27l8 8 16-17" />
          ) : (
            <path className="order-badge-mark" fill="none" d="M17 17l18 18M35 17L17 35" />
          )}
        </svg>
      )}
      <p className="type-section-title text-foreground">{text}</p>
    </div>
  );
}
