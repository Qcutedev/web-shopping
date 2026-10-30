"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { FieldMessage, hasContent, joinIds } from "./field";
import { CloseIcon, ErrorIcon, SuccessIcon } from "./icons";

export type FileUploadItemStatus = "uploading" | "done" | "error";

export interface FileUploadItem {
  /** Stable key, for example the client-side id of the pending upload. */
  id: string;
  name: string;
  status: FileUploadItemStatus;
  /** Whole percent 0 to 100 while `status` is "uploading". Leave out when unknown (indeterminate). */
  progress?: number;
  /** Text of the current state, for example "กำลังอัปโหลด 40%" or "อัปโหลดแล้ว" (from th.ts). */
  statusText: string;
  /** Why this file failed. Shown in place of the status text with an error icon. */
  errorText?: string;
}

export interface FileUploadProps {
  /** Visible label of the whole control (from th.ts). */
  label: ReactNode;
  /** Text in the drop zone, for example "ลากไฟล์มาวางที่นี่ หรือ". */
  dropText: ReactNode;
  /** Label of the choose-files button. */
  buttonLabel: string;
  /** The limits: type, size, count, for example "JPEG, PNG, WebP ไม่เกิน 4 MiB ไม่เกิน 8 ไฟล์". Always show them. */
  limitsText: ReactNode;
  /** Error that concerns the whole control (too many files, wrong type). Per-file errors go on the item. */
  errorText?: ReactNode;
  /** Accessible name of a file's remove button, for example `(name) => "ลบไฟล์ " + name`. */
  removeLabel: (name: string) => string;
  /** Accessible name of a file's progress bar, for example `(name) => "ความคืบหน้าของ " + name`. */
  progressLabel: (name: string) => string;
  /** Files already chosen or uploaded, with their state. The parent owns this list. */
  items?: readonly FileUploadItem[];
  /** Called with the chosen or dropped files. Check type, size, and count here and set errors. */
  onFiles: (files: File[]) => void;
  /** Shows a remove button on each file. */
  onRemove?: (id: string) => void;
  /** MIME types or extensions for the native picker, for example "image/jpeg,image/png". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Drop zone plus choose-files button, with a list of files and the state of each. It does not
 * upload anything or validate anything: it hands the files to `onFiles` and shows what the parent
 * reports. The picker is a real file input reached through the button, so the keyboard works;
 * dropping is an extra for pointer users. Dropped files go through the same `onFiles`.
 */
export function FileUpload({
  label,
  dropText,
  buttonLabel,
  limitsText,
  errorText,
  removeLabel,
  progressLabel,
  items = [],
  onFiles,
  onRemove,
  accept,
  multiple = false,
  disabled = false,
  id,
  className,
}: FileUploadProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const labelId = `${baseId}-label`;
  const limitsId = `${baseId}-limits`;
  const messageId = `${baseId}-message`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasError = hasContent(errorText);

  function pass(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0 || disabled) return;
    onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pass(event.dataTransfer.files);
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={joinIds(limitsId, hasError ? messageId : undefined)}
      className={cn("flex flex-col gap-2", className)}
    >
      <span id={labelId} className="type-label text-foreground block">
        {label}
      </span>

      <div
        data-dragging={dragging || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-150",
          hasError ? "border-danger" : "border-control-border",
          dragging ? "bg-primary-soft border-primary" : "bg-surface",
          disabled && "bg-surface-muted",
        )}
      >
        <p className="type-body text-foreground-secondary">{dropText}</p>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-describedby={limitsId}
        >
          {buttonLabel}
        </Button>
        <input
          ref={inputRef}
          id={baseId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          tabIndex={-1}
          className="hidden"
          onChange={(event) => {
            pass(event.target.files);
            // Lets the same file be chosen again after it was removed.
            event.target.value = "";
          }}
        />
        <p id={limitsId} className="type-caption text-foreground-muted">
          {limitsText}
        </p>
      </div>

      <FieldMessage id={messageId} errorText={errorText} />

      {items.length > 0 ? (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {items.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              disabled={disabled}
              removeLabel={removeLabel}
              progressLabel={progressLabel}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileRow({
  item,
  disabled,
  removeLabel,
  progressLabel,
  onRemove,
}: {
  item: FileUploadItem;
  disabled: boolean;
  removeLabel: FileUploadProps["removeLabel"];
  progressLabel: FileUploadProps["progressLabel"];
  onRemove?: FileUploadProps["onRemove"];
}) {
  const failed = item.status === "error";
  const progress =
    item.progress !== undefined && Number.isFinite(item.progress)
      ? Math.min(100, Math.max(0, Math.round(item.progress)))
      : undefined;
  return (
    <li
      data-status={item.status}
      className={cn(
        "bg-surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border p-3",
        failed ? "border-danger" : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span className="type-small text-foreground font-medium break-words">{item.name}</span>
        {item.status === "uploading" ? (
          <progress
            aria-label={progressLabel(item.name)}
            max={100}
            value={progress}
            className="bg-surface-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-primary h-2 w-full overflow-hidden rounded-full"
          />
        ) : null}
        {failed ? (
          <span className="type-caption text-danger flex items-start gap-1.5">
            <ErrorIcon className="mt-0.5 size-4" />
            <span>{item.errorText ?? item.statusText}</span>
          </span>
        ) : (
          <span
            className={cn(
              "type-caption flex items-start gap-1.5",
              item.status === "done" ? "text-success" : "text-foreground-secondary",
            )}
          >
            {item.status === "done" ? <SuccessIcon className="mt-0.5 size-4" /> : null}
            <span>{item.statusText}</span>
          </span>
        )}
      </div>
      {onRemove ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={removeLabel(item.name)}
          onClick={() => onRemove(item.id)}
        >
          <CloseIcon />
        </Button>
      ) : null}
    </li>
  );
}
