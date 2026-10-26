"use client";

import { type FormEvent, useRef, useState } from "react";
import { RequestError } from "@/components/account/request-error";
import { ReviewCard } from "@/components/catalog/reviews-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { TextareaField } from "@/components/ui/textarea";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import type { ApiFailure } from "@/lib/api-client/http";
import { createReview } from "@/lib/api-client/reviews";
import { orderHref } from "@/lib/routes";
import type { OrderReviewDto } from "@/modules/orders/schema";
import {
  createReviewBodySchema,
  MAX_RATING,
  MIN_RATING,
  REVIEW_COMMENT_MAX,
} from "@/modules/reviews/schema";

const RATINGS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, i) => MIN_RATING + i);

interface FormErrors {
  rating?: string;
  comment?: string;
}

/**
 * Client-side check with the server's schema, for feedback only: the server decides (BR-11, the
 * duplicate rule, the comment rule). An empty comment is left out of the body.
 */
export function validateReviewForm(
  rating: number | null,
  comment: string,
): { ok: true; body: { rating: number; comment?: string } } | { ok: false; errors: FormErrors } {
  if (rating === null) return { ok: false, errors: { rating: th.orders.review.ratingRequired } };
  const body = comment === "" ? { rating } : { rating, comment };
  const parsed = createReviewBodySchema.safeParse(body);
  if (parsed.success) return { ok: true, body };
  const errors: FormErrors = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === "rating") errors.rating = th.orders.review.ratingRequired;
    else if (issue.path[0] === "comment") {
      errors.comment =
        issue.code === "too_big"
          ? fill(th.orders.review.commentTooLong, { max: REVIEW_COMMENT_MAX })
          : th.orders.review.commentInvalid;
    }
  }
  if (errors.rating === undefined && errors.comment === undefined) {
    errors.comment = th.orders.review.commentInvalid;
  }
  return { ok: false, errors };
}

export interface ItemReviewProps {
  orderId: string;
  itemId: string;
  /** The review the order already carries, or `null`. */
  review: OrderReviewDto | null;
  /** True when the item's seller order is delivered (BR-11); the server judges it again. */
  delivered: boolean;
}

/**
 * Review of one order item (REQ-C-14, BR-11): shows the stored review, or for a delivered item
 * without one a button that opens the form. Hiding the form is a convenience; the server decides.
 */
export function ItemReview({ orderId, itemId, review, delivered }: ItemReviewProps) {
  const [saved, setSaved] = useState<OrderReviewDto | null>(review);
  const [justSaved, setJustSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Pick<ApiFailure, "status" | "code" | "reason"> | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  // A duplicate or not-delivered answer ends the attempt: the form goes away, the message stays.
  const [closedByServer, setClosedByServer] = useState(false);
  const pendingRef = useRef(false);

  const text = th.orders.review;

  if (saved !== null) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {justSaved ? <Alert tone="success">{text.submitted}</Alert> : null}
        <p className="type-label">{text.yourReview}</p>
        <ReviewCard review={saved} />
      </div>
    );
  }

  if (!delivered) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    setFailure(null);
    const result = validateReviewForm(rating, comment);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    pendingRef.current = true;
    setPending(true);
    const response = await createReview(orderId, itemId, result.body);
    pendingRef.current = false;
    setPending(false);
    if (response.ok) {
      setJustSaved(true);
      setSaved({
        id: response.data.id,
        rating: response.data.rating,
        comment: response.data.comment,
        createdAt: response.data.createdAt,
      });
      return;
    }
    if (response.code === "CONFLICT") setClosedByServer(true);
    setFailure(response);
  }

  if (closedByServer && failure !== null) {
    return (
      <div className="mt-2">
        <RequestError
          failure={failure}
          returnTo={orderHref(orderId)}
          message={apiErrorMessage(failure)}
        />
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {text.write}
        </Button>
      </div>
    );
  }

  const group = `rating-${itemId}`;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={text.formTitle}
      className="border-border mt-2 flex flex-col gap-4 rounded-sm border p-4"
    >
      {failure ? (
        <RequestError
          failure={failure}
          returnTo={orderHref(orderId)}
          message={apiErrorMessage(failure)}
        />
      ) : null}
      <RadioGroup legend={text.ratingLegend} errorText={errors.rating} disabled={pending}>
        <div className="flex flex-wrap gap-x-4">
          {RATINGS.map((value) => (
            <Radio
              key={value}
              name={group}
              value={value}
              checked={rating === value}
              onChange={() => setRating(value)}
              label={fill(text.ratingOption, { rating: value })}
            />
          ))}
        </div>
      </RadioGroup>
      <TextareaField
        label={text.commentLabel}
        name="comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        helperText={fill(text.commentHelper, { max: REVIEW_COMMENT_MAX })}
        errorText={errors.comment}
        disabled={pending}
      />
      <p className="type-small text-foreground-muted">{text.immutableNote}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          {text.submit}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          {th.account.common.cancel}
        </Button>
      </div>
    </form>
  );
}
