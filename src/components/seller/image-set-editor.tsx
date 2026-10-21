"use client";

import { type ChangeEvent, useId, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldMessage, Label } from "@/components/ui/field";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { uploadImage } from "@/lib/api-client/seller";
import { cn } from "@/lib/utils";
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
}: {
  label: string;
  images: readonly ImageRef[];
  max: number;
  disabled?: boolean;
  returnTo: string;
  onChange: (images: ImageRef[]) => void;
}) {
  const inputId = useId();
  const messageId = `${inputId}-message`;
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<SellerFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const single = max === 1;
  const full = !single && images.length >= max;

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || uploading) return;
    setProblem(null);
    setFailure(null);
    setNotice(null);
    const room = single ? 1 : max - images.length;
    let next = [...images];
    setUploading(true);
    let uploadedAny = false;
    for (const file of files.slice(0, room)) {
      if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
        setProblem(th.seller.images.wrongType);
        break;
      }
      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        setProblem(th.seller.images.tooBig);
        break;
      }
      const response = await uploadImage(file);
      if (!response.ok) {
        setFailure(response);
        break;
      }
      next = single
        ? [{ key: response.data.key, url: response.data.url }]
        : [...next, { key: response.data.key, url: response.data.url }];
      uploadedAny = true;
    }
    setUploading(false);
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
      <Label htmlFor={inputId}>{label}</Label>
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

      <div className="flex flex-wrap items-center gap-3">
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          multiple={!single}
          disabled={disabled || uploading || full}
          aria-describedby={messageId}
          onChange={onFiles}
          className={cn(
            "type-small file:border-control-border file:bg-surface file:text-foreground focus-ring file:type-label max-w-full file:mr-3 file:h-11 file:rounded-sm file:border file:px-4",
            "disabled:cursor-not-allowed",
          )}
        />
        {uploading ? (
          <span role="status" className="type-small text-foreground-secondary">
            {th.seller.images.uploading}
          </span>
        ) : null}
      </div>
      <FieldMessage
        id={messageId}
        helperText={[
          th.seller.images.helper,
          single ? null : fill(th.seller.images.limit, { max }),
          single ? null : th.seller.images.firstNote,
        ]
          .filter(Boolean)
          .join(" ")}
        errorText={problem ?? undefined}
      />
    </div>
  );
}
