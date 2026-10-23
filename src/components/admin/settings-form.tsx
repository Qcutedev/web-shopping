"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { NoticeLabel } from "@/components/ui/notice-label";
import { satangToBaht } from "@/components/catalog/price-filter";
import {
  type FieldErrors,
  messageForCode,
  serverFieldErrors,
  validateWith,
} from "@/components/seller/form-validation";
import { th } from "@/i18n/th";
import { updateSettings } from "@/lib/api-client/admin";
import { formatDateTime } from "@/lib/format";
import type { SettingsDto, UpdateSettingsBody } from "@/modules/admin/schema";
import { updateSettingsFormSchema } from "./client-schemas";
import { bpsToPercent, settingsChanges } from "./form-model";
import { AdminRequestError, type AdminFailure } from "./request-error";
import { ADMIN_ROUTES } from "./routes";

const FIELDS = ["flatShippingFeeSatang", "commissionRateBps"] as const;
type Field = (typeof FIELDS)[number];
const COPY = th.admin.settings.fieldErrors;

/**
 * The two marketplace settings (REQ-A-09). The fee is typed in baht and the commission as a whole
 * percent; the body carries integer satang and basis points, only for what changed. The answer of
 * the server replaces the form's baseline after a save. The server enforces every bound (BR-28).
 */
export function SettingsForm({ settings }: { settings: SettingsDto }) {
  const router = useRouter();
  const [saved, setSaved] = useState(settings);
  const [feeText, setFeeText] = useState(satangToBaht(settings.flatShippingFeeSatang));
  const [percentText, setPercentText] = useState(bpsToPercent(settings.commissionRateBps));
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [failure, setFailure] = useState<AdminFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setFormMessage(null);
    setSuccess(null);

    const blank: FieldErrors<Field> = {};
    if (feeText.trim() === "") blank.flatShippingFeeSatang = COPY.flatShippingFeeSatang.required;
    if (percentText.trim() === "") blank.commissionRateBps = COPY.commissionRateBps.required;
    if (Object.keys(blank).length > 0) {
      setErrors(blank);
      return;
    }

    const changes = settingsChanges(saved, { feeText, percentText });
    if (Object.keys(changes).length === 0) {
      setErrors({});
      setSuccess(th.admin.settings.noChange);
      return;
    }
    const result = validateWith<UpdateSettingsBody, Field>(
      updateSettingsFormSchema,
      changes,
      FIELDS,
      COPY,
    );
    if (!result.ok) {
      setErrors(result.errors);
      if (result.unplaced) setFormMessage(th.admin.common.formInvalid);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await updateSettings(result.body);
    setPending(false);
    if (response.ok) {
      setSaved(response.data);
      setFeeText(satangToBaht(response.data.flatShippingFeeSatang));
      setPercentText(bpsToPercent(response.data.commissionRateBps));
      setSuccess(th.admin.settings.saved);
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, FIELDS, (field, code) =>
        messageForCode(COPY[field], code),
      );
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.admin.common.formInvalid);
      return;
    }
    setFailure(response);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="settings-form-title">
      <CardTitle as="h2" size="panel" id="settings-form-title">
        {th.admin.settings.formTitle}
      </CardTitle>
      <p className="type-small text-foreground-muted mt-1">
        {th.admin.settings.updatedAt}: {formatDateTime(saved.updatedAt)}
      </p>
      {success ? (
        <Alert tone="success" className="mt-4" role="status">
          {success}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {failure ? <AdminRequestError failure={failure} returnTo={ADMIN_ROUTES.settings} /> : null}
        {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
        <InputField
          label={th.admin.settings.shippingFee}
          name="flatShippingFeeSatang"
          inputMode="decimal"
          value={feeText}
          onChange={(event) => setFeeText(event.target.value)}
          helperText={
            <>
              {th.admin.settings.shippingFeeHelper}{" "}
              <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
            </>
          }
          errorText={errors.flatShippingFeeSatang}
          autoComplete="off"
          required
          disabled={pending}
        />
        <InputField
          label={th.admin.settings.commission}
          name="commissionRateBps"
          inputMode="numeric"
          value={percentText}
          onChange={(event) => setPercentText(event.target.value)}
          helperText={th.admin.settings.commissionHelper}
          errorText={errors.commissionRateBps}
          autoComplete="off"
          required
          disabled={pending}
        />
        <div>
          <Button type="submit" loading={pending} disabled={pending}>
            {th.admin.settings.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
