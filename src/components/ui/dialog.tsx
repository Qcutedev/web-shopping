"use client";

import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { CloseIcon } from "./icons";

export type DialogSize = "sm" | "md" | "lg";

const SIZES: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribe = () => () => {};

export interface DialogProps {
  open: boolean;
  /** Called on Escape, on the close button, and on a click on the backdrop (when allowed). The parent sets `open` to false. */
  onClose: () => void;
  /** Visible title. It names the dialog. */
  title: ReactNode;
  /** One or two sentences under the title. It describes the dialog; required for an alertdialog. */
  description?: ReactNode;
  /** Accessible name of the close button (from th.ts). */
  closeLabel: string;
  /** Body content, for example a form. */
  children?: ReactNode;
  /** Actions, right-aligned. Put the primary action last. */
  footer?: ReactNode;
  /**
   * "alertdialog" asks the person to confirm or cancel something that cannot be undone. It does not
   * close on a backdrop click.
   */
  role?: "dialog" | "alertdialog";
  size?: DialogSize;
  /**
   * False while a request is running: Escape, the close button, and the backdrop do nothing, so the
   * dialog cannot vanish under a pending action. Default true.
   */
  dismissible?: boolean;
  /** Close on a backdrop click. Default true for "dialog", false for "alertdialog". */
  closeOnBackdrop?: boolean;
  /** Element to focus when the dialog opens. Default: the first control in the body or footer, else the close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Modal dialog. Rendered in a portal at the end of `body`. While open: focus moves into the
 * dialog, Tab and Shift+Tab stay inside it, Escape closes it, page scrolling is locked, and on
 * close focus returns to the element that had it before (normally the trigger). Open one dialog at
 * a time; stacking dialogs is not supported.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  children,
  footer,
  role = "dialog",
  size = "md",
  dismissible = true,
  closeOnBackdrop,
  initialFocusRef,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // The effect below runs once per open, so it reads the latest props through refs.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const initialFocusRefRef = useRef(initialFocusRef);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
    initialFocusRefRef.current = initialFocusRef;
  });

  const visible = open && mounted;
  useEffect(() => {
    if (!visible) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const tabbables = () => Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE));

    const requested = initialFocusRefRef.current?.current;
    const first = tabbables().find((el) => !el.hasAttribute("data-dialog-close"));
    (requested ?? first ?? tabbables()[0] ?? panel).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = tabbables();
      if (items.length === 0) {
        event.preventDefault();
        panel!.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (!panel!.contains(active) || active === panel) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
      } else if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    // Focus that escapes by a click on the page or by a script is pulled back in.
    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !panel!.contains(event.target)) {
        (tabbables()[0] ?? panel!).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [visible]);

  if (!visible) return null;

  const backdropCloses = closeOnBackdrop ?? role !== "alertdialog";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        data-dialog-backdrop=""
        className="bg-ink/50 absolute inset-0"
        onClick={() => {
          if (backdropCloses && dismissible) onClose();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "bg-surface text-foreground relative flex max-h-[calc(100dvh-1rem)] w-full flex-col rounded-t-lg shadow-lg outline-none sm:max-h-[calc(100dvh-4rem)] sm:rounded-lg",
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-start gap-3 px-4 pt-4 md:px-6 md:pt-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
            <h2 id={titleId} className="type-panel-title break-words">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="type-body text-foreground-secondary">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            data-dialog-close=""
            aria-label={closeLabel}
            disabled={!dismissible}
            onClick={onClose}
            className="-mr-2 w-11 px-0"
          >
            <CloseIcon />
          </Button>
        </div>
        {children ? <div className="overflow-y-auto px-4 py-4 md:px-6">{children}</div> : null}
        {footer ? (
          <div className="border-border flex flex-wrap justify-end gap-3 border-t px-4 py-4 md:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
