"use client";

import { useEffect, useRef } from "react";
import { th } from "@/i18n/th";

/**
 * Error summary of the GET filter form. The form reloads the document, so a `role="alert"` that is
 * already present at load may not be announced; moving focus to the summary makes the screen reader
 * read it (CR-T021-21).
 */
export function FilterErrorSummary({ messages }: { messages: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="text-danger type-body-sm focus-ring rounded-sm"
    >
      <p className="font-medium">{th.catalog.filter.errorSummary}</p>
      <ul className="list-disc ps-5">
        {messages.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
