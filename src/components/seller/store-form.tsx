"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { TextareaField } from "@/components/ui/textarea";
import { th } from "@/i18n/th";
import { updateStore } from "@/lib/api-client/seller";
import { storeHref } from "@/lib/routes";
import type { ImageRef } from "@/modules/catalog/schema";
import {
  type SellerStoreDto,
  type UpdateStoreBody,
  updateStoreBodySchema,
} from "@/modules/sellers/schema";
import {
  type FieldErrors,
  messageForCode,
  serverFieldErrors,
  validateWith,
} from "./form-validation";
import { ImageSetEditor } from "./image-set-editor";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { SELLER_ROUTES } from "./routes";
import { StoreStatusBadge } from "./status-badges";

const FIELDS = ["name", "description", "contactPhone", "logoKey"] as const;
type Field = (typeof FIELDS)[number];

const COPY = {
  ...th.seller.fieldErrors,
  // A logo key is never typed; a refusal of it is a general message.
  logoKey: th.seller.fieldErrors.name,
};

/** Only the fields that differ from the stored store are sent (REQ-S-02). Pure; unit tested. */
export function storeChanges(
  saved: Pick<SellerStoreDto, "name" | "description" | "contactPhone" | "logo">,
  values: { name: string; description: string; contactPhone: string; logo: ImageRef | null },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (values.name !== saved.name) body.name = values.name;
  if (values.description.trim() !== (saved.description ?? "")) {
    body.description = values.description.trim() === "" ? null : values.description;
  }
  if (values.contactPhone !== saved.contactPhone) body.contactPhone = values.contactPhone;
  if ((values.logo?.key ?? null) !== (saved.logo?.key ?? null)) {
    body.logoKey = values.logo?.key ?? null;
  }
  return body;
}

/**
 * Store settings (REQ-S-02, REQ-S-05). A suspended store is shown read-only: the controls are
 * disabled for the person's convenience, and the server refuses every change either way
 * (BR-14). The answer of the server replaces the form's baseline after a save.
 */
export function StoreForm({ store }: { store: SellerStoreDto }) {
  const router = useRouter();
  const [saved, setSaved] = useState(store);
  const [name, setName] = useState(store.name);
  const [description, setDescription] = useState(store.description ?? "");
  const [contactPhone, setContactPhone] = useState(store.contactPhone);
  const [logo, setLogo] = useState<ImageRef | null>(store.logo);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [failure, setFailure] = useState<SellerFailure | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const suspended = saved.status === "SUSPENDED";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || suspended) return;
    setFailure(null);
    setFormMessage(null);
    setSuccess(null);
    const changes = storeChanges(saved, { name, description, contactPhone, logo });
    if (Object.keys(changes).length === 0) {
      setErrors({});
      setSuccess(th.seller.store.noChange);
      return;
    }
    const result = validateWith<UpdateStoreBody, Field>(
      updateStoreBodySchema,
      changes,
      FIELDS,
      COPY,
    );
    if (!result.ok) {
      setErrors(result.errors);
      if (result.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await updateStore(result.body);
    setPending(false);
    if (response.ok) {
      setSaved(response.data);
      setName(response.data.name);
      setDescription(response.data.description ?? "");
      setContactPhone(response.data.contactPhone);
      setLogo(response.data.logo);
      setSuccess(th.seller.store.saved);
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, FIELDS, (field, code) =>
        messageForCode(COPY[field], code),
      );
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    // A name conflict belongs under the name field.
    if (
      response.code === "CONFLICT" &&
      (response.reason === "STORE_NAME_TAKEN" || response.reason === "STORE_NAME_RESERVED")
    ) {
      setErrors({ name: th.seller.errors.reasons[response.reason] });
      return;
    }
    if (response.code === "SELLER_NOT_APPROVED") router.refresh();
    setFailure(response);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="store-form-title">
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle as="h2" size="panel" id="store-form-title">
          {th.seller.store.formTitle}
        </CardTitle>
        <StoreStatusBadge status={saved.status} />
      </div>
      {suspended ? (
        <Alert tone="warning" className="mt-4" role="note">
          {th.seller.store.suspendedNote}
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success" className="mt-4">
          {success}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {failure ? <SellerRequestError failure={failure} returnTo={SELLER_ROUTES.store} /> : null}
        {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
        <InputField
          label={th.seller.store.fields.name}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          helperText={th.seller.store.nameHelper}
          errorText={errors.name}
          required
          disabled={pending || suspended}
        />
        <TextareaField
          label={th.seller.store.fields.description}
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          errorText={errors.description}
          disabled={pending || suspended}
        />
        <InputField
          label={th.seller.store.fields.contactPhone}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={contactPhone}
          onChange={(event) => setContactPhone(event.target.value)}
          helperText={th.seller.store.phoneHelper}
          errorText={errors.contactPhone}
          required
          disabled={pending || suspended}
        />
        <ImageSetEditor
          label={th.seller.store.fields.logo}
          images={logo ? [logo] : []}
          max={1}
          disabled={pending || suspended}
          returnTo={SELLER_ROUTES.store}
          onChange={(images) => setLogo(images[0] ?? null)}
        />
        {errors.logoKey ? <Alert tone="danger">{th.seller.common.formInvalid}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending} disabled={suspended}>
            {th.seller.store.save}
          </Button>
          {saved.status === "APPROVED" ? (
            <Link href={storeHref(saved.slug)} className={buttonVariants({ variant: "secondary" })}>
              {th.seller.store.viewPublic}
            </Link>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
