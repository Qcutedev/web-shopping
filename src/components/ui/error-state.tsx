import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ErrorIcon } from "./icons";

interface ErrorStateBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional one-line title. */
  title?: ReactNode;
  /** Heading level of the title. */
  titleAs?: "h2" | "h3" | "h4" | "p";
  /** What happened and what the person can do, in Thai (from th.ts). */
  message: ReactNode;
}

interface ErrorStateRetryProps extends ErrorStateBaseProps {
  /** Label of the retry button (from th.ts). */
  retryLabel: string;
  /** Called when the retry button is pressed. Needs a Client Component parent. */
  onRetry: () => void;
  /** Shows the retry button in its loading state while the retry is running. */
  retrying?: boolean;
  action?: never;
}

interface ErrorStateActionProps extends ErrorStateBaseProps {
  /** A custom action instead of the retry button, for example a link that reloads the page. */
  action?: ReactNode;
  retryLabel?: never;
  onRetry?: never;
  retrying?: never;
}

export type ErrorStateProps = ErrorStateRetryProps | ErrorStateActionProps;

/**
 * Shown in place of data that failed to load. Announced as an alert. The icon and the text carry
 * the meaning; colour only supports them.
 */
export function ErrorState({
  title,
  titleAs: Title = "h2",
  message,
  retryLabel,
  onRetry,
  retrying,
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center md:py-14", className)}
      {...props}
    >
      <div
        aria-hidden="true"
        className="bg-danger-soft text-danger mb-2 flex size-14 items-center justify-center rounded-full"
      >
        <ErrorIcon className="size-6" />
      </div>
      {title ? <Title className="type-card-title text-foreground">{title}</Title> : null}
      <p className="type-body text-foreground-secondary max-w-prose">{message}</p>
      {onRetry && retryLabel ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        </div>
      ) : action ? (
        <div className="mt-4">{action}</div>
      ) : null}
    </div>
  );
}
