"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { changeStock } from "@/lib/api-client/seller";
import { type StockBody, stockBodySchema } from "@/modules/inventory/schema";
import { formatCount } from "./format-count";
import { parseIntegerInput } from "./product-form-model";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { sellerProductHref } from "./routes";
import { useSyncedState } from "./use-synced-state";

type Mode = "set" | "adjust";

/**
 * Stock of one product (REQ-S-06): set an absolute value, or adjust by a delta. The new stock is
 * the server's answer; nothing is added up here. A refused change (negative result, above
 * 1,000,000, suspended store) leaves the shown stock as it was.
 */
export function StockPanel({
  product,
  disabled = false,
}: {
  product: { id: string; stock: number };
  disabled?: boolean;
}) {
  const router = useRouter();
  const [stock, setStock] = useSyncedState(product.stock);
  const [text, setText] = useState<Record<Mode, string>>({ set: "", adjust: "" });
  const [errors, setErrors] = useState<Partial<Record<Mode, string>>>({});
  const [pending, setPending] = useState<Mode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<SellerFailure | null>(null);

  async function submit(mode: Mode, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending !== null || disabled) return;
    setFailure(null);
    setNotice(null);
    const parsed = parseIntegerInput(text[mode], mode === "adjust");
    if (!parsed.ok) {
      setErrors({ [mode]: th.seller.fieldErrors[mode][parsed.kind] });
      return;
    }
    const body: StockBody = mode === "set" ? { set: parsed.value } : { adjust: parsed.value };
    const checked = stockBodySchema.safeParse(body);
    if (!checked.success) {
      const code = checked.error.issues[0]?.code;
      setErrors({
        [mode]:
          code === "too_big"
            ? th.seller.fieldErrors[mode].tooLong
            : th.seller.fieldErrors[mode].invalid,
      });
      return;
    }
    setErrors({});
    setPending(mode);
    const response = await changeStock(product.id, checked.data);
    setPending(null);
    if (response.ok) {
      setStock(response.data.stock);
      setText({ set: "", adjust: "" });
      setNotice(th.seller.products.stock.updated);
      router.refresh();
      return;
    }
    if (response.code === "SELLER_NOT_APPROVED" || response.code === "NOT_FOUND") router.refresh();
    setFailure(response);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="stock-panel-title">
      <CardTitle as="h2" size="panel" id="stock-panel-title">
        {th.seller.products.stock.title}
      </CardTitle>
      <p className="type-body mt-2" role="status">
        {th.seller.products.stock.current}:{" "}
        <strong>
          {fill(th.seller.products.stock.currentCount, { count: formatCount(stock) })}
        </strong>
      </p>
      <p className="type-small text-foreground-muted">{th.seller.products.stock.note}</p>
      {notice ? (
        <Alert tone="success" className="mt-4">
          {notice}
        </Alert>
      ) : null}
      {failure ? (
        <div className="mt-4">
          <SellerRequestError failure={failure} returnTo={sellerProductHref(product.id)} />
        </div>
      ) : null}
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <form
          onSubmit={(event) => void submit("set", event)}
          noValidate
          className="flex flex-col gap-3"
        >
          <InputField
            label={th.seller.products.stock.set}
            name="stockSet"
            inputMode="numeric"
            autoComplete="off"
            value={text.set}
            onChange={(event) => setText((current) => ({ ...current, set: event.target.value }))}
            errorText={errors.set}
            disabled={disabled || pending !== null}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={pending === "set"}
              disabled={disabled || pending === "adjust"}
            >
              {th.seller.products.stock.setAction}
            </Button>
          </div>
        </form>
        <form
          onSubmit={(event) => void submit("adjust", event)}
          noValidate
          className="flex flex-col gap-3"
        >
          <InputField
            label={th.seller.products.stock.adjust}
            name="stockAdjust"
            autoComplete="off"
            value={text.adjust}
            onChange={(event) => setText((current) => ({ ...current, adjust: event.target.value }))}
            helperText={th.seller.products.stock.adjustHelper}
            errorText={errors.adjust}
            disabled={disabled || pending !== null}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={pending === "adjust"}
              disabled={disabled || pending === "set"}
            >
              {th.seller.products.stock.adjustAction}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
