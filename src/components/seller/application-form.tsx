"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { TextareaField } from "@/components/ui/textarea";
import { th } from "@/i18n/th";
import { submitApplication } from "@/lib/api-client/seller";
import { submitApplicationBodySchema } from "@/modules/sellers/schema";
import {
  type FieldErrors,
  messageForCode,
  serverFieldErrors,
  validateWith,
} from "./form-validation";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { SELLER_ROUTES } from "./routes";

const FIELDS = ["storeName", "description", "contactPhone"] as const;
type Field = (typeof FIELDS)[number];

/**
 * Apply to sell (REQ-S-01): store name, description, contact phone. One submit at a time; the
 * server's answer is the truth, and the page is refreshed after a success so the status card is
 * shown from the stored application.
 */
export function ApplicationForm({ title }: { title: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
    storeName: "",
    description: "",
    contactPhone: "",
  });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [failure, setFailure] = useState<SellerFailure | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setFormMessage(null);
    const result = validateWith(submitApplicationBodySchema, values, FIELDS, th.seller.fieldErrors);
    if (!result.ok) {
      setErrors(result.errors);
      if (result.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await submitApplication(result.body);
    setPending(false);
    if (response.ok) {
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, FIELDS, (field, code) =>
        messageForCode(th.seller.fieldErrors[field], code),
      );
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    // The application list may have changed (a second submit): show the truth.
    if (response.reason === "OPEN_APPLICATION") router.refresh();
    setFailure(response);
  }

  function set(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="application-form-title">
      <CardTitle as="h2" size="panel" id="application-form-title">
        {title}
      </CardTitle>
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {failure ? <SellerRequestError failure={failure} returnTo={SELLER_ROUTES.apply} /> : null}
        {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
        <InputField
          label={th.seller.apply.fields.storeName}
          name="storeName"
          value={values.storeName}
          onChange={(event) => set("storeName", event.target.value)}
          errorText={errors.storeName}
          autoComplete="organization"
          required
          disabled={pending}
        />
        <TextareaField
          label={th.seller.apply.fields.description}
          name="description"
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          errorText={errors.description}
          required
          disabled={pending}
        />
        <InputField
          label={th.seller.apply.fields.contactPhone}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={values.contactPhone}
          onChange={(event) => set("contactPhone", event.target.value)}
          helperText={th.seller.apply.phoneHelper}
          errorText={errors.contactPhone}
          required
          disabled={pending}
        />
        <div>
          <Button type="submit" loading={pending}>
            {th.seller.apply.submit}
          </Button>
        </div>
      </form>
    </Card>
  );
}
