"use client";

import { useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileUpload, type FileUploadItem } from "@/components/ui/file-upload";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { uploadImage } from "@/lib/api-client/seller";
import type { ImageRef } from "@/modules/catalog/schema";
import { MAX_UPLOAD_FILE_BYTES, UPLOAD_CONTENT_TYPES } from "@/modules/uploads/schema";
import { SellerRequestError, type SellerFailure } from "./request-error";

const ACCEPT = UPLOAD_CONTENT_TYPES.join(",");

/**
 * An ordered set of pictures with upload, remove, and move up or down (REQ-S-05). It holds no
 * truth: the parent keeps the list, and a picture is attached only when the parent saves its
 * keys (`imageKeys` or `logoKey`). With `max` 1 a new upload replaces the picture. The size and
 * type checks here only save a round trip; the server checks the leading bytes and the size.
 * Reordering is by buttons, so it works by keyboard.
 */
export function ImageSetEditor({
  label,
  images,
  max,
  disabled = false,
  returnTo,
  onChange,
  onBusyChange,
}: {
  label: string;
  images: readonly ImageRef[];
  max: number;
  disabled?: boolean;
  returnTo: string;
  onChange: (images: ImageRef[]) => void;
  /** Called with true while an upload is in flight, so the parent can hold its save button. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<FileUploadItem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<SellerFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const single = max === 1;
  const full = !single && images.length >= max;

  function setItem(id: string, patch: Partial<FileUploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function onFiles(files: File[]) {
    if (files.length === 0 || uploading) return;
    setProblem(null);
    setFailure(null);
    setNotice(null);
    const room = single ? 1 : max - images.length;
    let next = [...images];
    const batch = files
      .slice(0, room)
      .map((file, index) => ({ file, id: `${index}-${file.name}` }));
    setItems(
      batch.map(({ file, id }) => ({
        id,
        name: file.name,
        status: "uploading" as const,
        statusText: th.seller.images.uploading,
      })),
    );
    setUploading(true);
    onBusyChange?.(true);
    let uploadedAny = false;
    // Files beyond the room left are not uploaded; say so instead of dropping them silently.
    if (files.length > room) {
      setProblem(fill(th.seller.images.skipped, { count: files.length - room }));
    }
    for (const { file, id } of batch) {
      if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
        setProblem(th.seller.images.wrongType);
        setItem(id, { status: "error", statusText: th.fileUpload.failed });
        break;
      }
      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        setProblem(th.seller.images.tooBig);
        setItem(id, { status: "error", statusText: th.fileUpload.failed });
        break;
      }
      const response = await uploadImage(file);
      if (!response.ok) {
        setFailure(response);
        setItem(id, { status: "error", statusText: th.fileUpload.failed });
        break;
      }
      setItem(id, { status: "done", statusText: th.fileUpload.done });
      next = single
        ? [{ key: response.data.key, url: response.data.url }]
        : [...next, { key: response.data.key, url: response.data.url }];
      uploadedAny = true;
    }
    setUploading(false);
    onBusyChange?.(false);
    if (uploadedAny) {
      onChange(next);
      setNotice(th.seller.images.uploaded);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setNotice(null);
    onChange(next);
  }

  function remove(index: number) {
    setNotice(null);
    onChange(images.filter((_, position) => position !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {failure ? <SellerRequestError failure={failure} returnTo={returnTo} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {images.length === 0 ? (
        <p className="type-small text-foreground-muted">{th.seller.images.empty}</p>
      ) : (
        <ul aria-label={th.seller.images.listLabel} className="flex flex-col gap-3">
          {images.map((image, index) => {
            const position = index + 1;
            return (
              <li key={image.key} className="flex flex-wrap items-center gap-3">
                <ProductImage
                  image={image}
                  alt={fill(th.seller.images.alt, { index: position, count: images.length })}
                  sizes="96px"
                  className="size-24 shrink-0"
                />
                <div className="flex flex-wrap gap-2">
                  {!single ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={disabled || uploading || index === 0}
                        aria-label={fill(th.seller.images.moveUpLabel, { index: position })}
                        onClick={() => move(index, -1)}
                      >
                        {th.seller.images.moveUp}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={disabled || uploading || index === images.length - 1}
                        aria-label={fill(th.seller.images.moveDownLabel, { index: position })}
                        onClick={() => move(index, 1)}
                      >
                        {th.seller.images.moveDown}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || uploading}
                    aria-label={fill(th.seller.images.removeLabel, { index: position })}
                    onClick={() => remove(index)}
                  >
                    {th.seller.images.remove}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <FileUpload
        label={label}
        dropText={th.fileUpload.drop}
        buttonLabel={th.fileUpload.choosePictures}
        limitsText={[
          th.seller.images.helper,
          single ? null : fill(th.seller.images.limit, { max }),
          single ? null : th.seller.images.firstNote,
        ]
          .filter(Boolean)
          .join(" ")}
        errorText={problem ?? undefined}
        removeLabel={(name) => fill(th.fileUpload.remove, { name })}
        progressLabel={(name) => fill(th.fileUpload.progress, { name })}
        items={items}
        onFiles={(files) => void onFiles(files)}
        accept={ACCEPT}
        multiple={!single}
        disabled={disabled || uploading || full}
      />
    </div>
  );
}
