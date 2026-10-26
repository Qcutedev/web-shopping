import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { REVIEW_COMMENT_MAX } from "@/modules/reviews/schema";

const api = { createReview: vi.fn() };
vi.mock("@/lib/api-client/reviews", () => ({
  createReview: (...args: unknown[]) => api.createReview(...args),
}));

import { ItemReview, validateReviewForm } from "./item-review";

const text = th.orders.review;
const STORED = {
  id: "r1",
  rating: 4,
  comment: "<b>อร่อย</b>\nมาก",
  createdAt: "2026-10-20T03:00:00.000Z",
};

function failure(status: number, code: string, reason?: string) {
  return { ok: false, status, code, ...(reason ? { reason } : {}), fields: [], requestId: null };
}

function renderItem(over: { review?: typeof STORED | null; delivered?: boolean } = {}) {
  return render(
    <ItemReview
      orderId="o1"
      itemId="i1"
      review={over.review ?? null}
      delivered={over.delivered ?? true}
    />,
  );
}

async function openForm() {
  await userEvent.click(screen.getByRole("button", { name: text.write }));
}

beforeEach(() => {
  api.createReview.mockReset();
});

describe("ItemReview", () => {
  it("renders nothing for an item that is not delivered", () => {
    const { container } = renderItem({ delivered: false });
    expect(container.textContent).toBe("");
  });

  it("shows the stored review as plain text, without a write button", () => {
    const { container } = renderItem({ review: STORED });
    expect(screen.getByText(text.yourReview)).toBeTruthy();
    expect(screen.getByText(fill(th.catalog.product.reviewRating, { rating: 4 }))).toBeTruthy();
    expect(container.textContent).toContain("<b>อร่อย</b>");
    expect(container.querySelector("b")).toBeNull();
    expect(screen.queryByRole("button", { name: text.write })).toBeNull();
  });

  it("shows a stored review even when the seller order is not delivered", () => {
    renderItem({ review: STORED, delivered: false });
    expect(screen.getByText(text.yourReview)).toBeTruthy();
  });

  it("opens the form and cancels it", async () => {
    renderItem();
    await openForm();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: th.account.common.cancel }));
    expect(screen.getByRole("button", { name: text.write })).toBeTruthy();
  });

  it("asks for a rating and sends nothing without one", async () => {
    renderItem();
    await openForm();
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    expect(screen.getByText(text.ratingRequired)).toBeTruthy();
    expect(api.createReview).not.toHaveBeenCalled();
  });

  it("refuses a comment over the limit before sending", async () => {
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 5 }) }),
    );
    const box = screen.getByLabelText(text.commentLabel);
    await userEvent.click(box);
    await userEvent.paste("ก".repeat(REVIEW_COMMENT_MAX + 1));
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    expect(screen.getByText(fill(text.commentTooLong, { max: REVIEW_COMMENT_MAX }))).toBeTruthy();
    expect(api.createReview).not.toHaveBeenCalled();
  });

  it("sends rating and comment only, disables submit while pending, then shows the review", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.createReview.mockReturnValue(new Promise((r) => (resolve = r)));
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 4 }) }),
    );
    await userEvent.click(screen.getByLabelText(text.commentLabel));
    await userEvent.paste("ดีมาก");
    await userEvent.click(screen.getByRole("button", { name: text.submit }));

    expect(api.createReview).toHaveBeenCalledWith("o1", "i1", { rating: 4, comment: "ดีมาก" });
    const submit = screen.getByRole("button", { name: text.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    resolve({ ok: true, status: 201, data: { ...STORED, comment: "ดีมาก" } });
    await waitFor(() => expect(screen.getByText(text.submitted)).toBeTruthy());
    expect(screen.getByText(text.yourReview)).toBeTruthy();
    expect(screen.queryByRole("button", { name: text.submit })).toBeNull();
    expect(api.createReview).toHaveBeenCalledTimes(1);
  });

  it("omits an empty comment from the body", async () => {
    api.createReview.mockResolvedValue({
      ok: true,
      status: 201,
      data: { ...STORED, comment: null },
    });
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 2 }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    expect(api.createReview).toHaveBeenCalledWith("o1", "i1", { rating: 2 });
    await waitFor(() => expect(screen.getByText(th.catalog.product.noComment)).toBeTruthy());
  });

  it("keeps the form and the input after a network failure, so it can be retried", async () => {
    api.createReview.mockResolvedValue(failure(0, "NETWORK_ERROR"));
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 3 }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(th.errors.network));
    expect(
      (
        screen.getByRole("radio", {
          name: fill(text.ratingOption, { rating: 3 }),
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect((screen.getByRole("button", { name: text.submit }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    api.createReview.mockResolvedValue({ ok: true, status: 201, data: STORED });
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    await waitFor(() => expect(screen.getByText(text.submitted)).toBeTruthy());
  });

  it("maps DUPLICATE_REVIEW to Thai copy and closes the form", async () => {
    api.createReview.mockResolvedValue(failure(409, "CONFLICT", "DUPLICATE_REVIEW"));
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 5 }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(th.errors.reasons.DUPLICATE_REVIEW),
    );
    expect(screen.queryByRole("button", { name: text.submit })).toBeNull();
  });

  it("maps NOT_DELIVERED to Thai copy", async () => {
    api.createReview.mockResolvedValue(failure(409, "CONFLICT", "NOT_DELIVERED"));
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 1 }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(th.errors.reasons.NOT_DELIVERED),
    );
  });

  it("offers sign-in when the session ended", async () => {
    api.createReview.mockResolvedValue(failure(401, "UNAUTHENTICATED"));
    renderItem();
    await openForm();
    await userEvent.click(
      screen.getByRole("radio", { name: fill(text.ratingOption, { rating: 5 }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: text.submit }));
    const link = await screen.findByRole("link", { name: th.shell.header.signIn });
    expect(link.getAttribute("href")).toContain(encodeURIComponent("/orders/o1"));
  });
});

describe("validateReviewForm", () => {
  it("accepts a rating alone and a normal comment", () => {
    expect(validateReviewForm(5, "")).toEqual({ ok: true, body: { rating: 5 } });
    expect(validateReviewForm(1, "ok")).toEqual({ ok: true, body: { rating: 1, comment: "ok" } });
  });

  it("flags a control character in the comment", () => {
    const result = validateReviewForm(3, "a\u0007b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.comment).toBe(text.commentInvalid);
  });
});
