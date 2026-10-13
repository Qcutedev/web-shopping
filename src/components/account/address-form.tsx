"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InputField } from "@/components/ui/input";
import { th } from "@/i18n/th";
import type { ApiFailure } from "@/lib/api-client/http";
import { createAddress, updateAddress } from "@/lib/api-client/me";
import { ROUTES } from "@/lib/routes";
import type { AddressDto } from "@/modules/profile/schema";
import { RequestError } from "./request-error";
import {
  ADDRESS_TEXT_FIELDS,
  type AddressFormValues,
  type AddressTextField,
  addressServerMessage,
  EMPTY_ADDRESS_VALUES,
  type FieldErrors,
  serverFieldErrors,
  validateAddressForm,
} from "./validation";

export interface AddressFormProps {
  /** `create` posts a new address; `edit` patches `address`. */
  address: AddressDto | null;
  /** Called with the address the server returned. */
  onSaved: (address: AddressDto, kind: "created" | "updated") => void;
  onCancel: () => void;
  /** Called when the address no longer exists (404), so the list can refresh. */
  onGone?: () => void;
}

const TEXT_FIELD_PROPS: Record<
  AddressTextField,
  { autoComplete: string; type?: string; inputMode?: "tel" | "numeric" }
> = {
  recipientName: { autoComplete: "name" },
  phone: { autoComplete: "tel", type: "tel", inputMode: "tel" },
  line1: { autoComplete: "address-line1" },
  subdistrict: { autoComplete: "address-level3" },
  district: { autoComplete: "address-level2" },
  province: { autoComplete: "address-level1" },
  postalCode: { autoComplete: "postal-code", inputMode: "numeric" },
};

function initialValues(address: AddressDto | null): AddressFormValues {
  if (address === null) return EMPTY_ADDRESS_VALUES;
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    subdistrict: address.subdistrict,
    district: address.district,
    province: address.province,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
  };
}

/**
 * Add or edit an address (REQ-C-04). The form validates with the server's schema for feedback
 * only; the server answers with the stored address, which the caller shows.
 */
export function AddressForm({ address, onSaved, onCancel, onGone }: AddressFormProps) {
  const [values, setValues] = useState<AddressFormValues>(() => initialValues(address));
  const [errors, setErrors] = useState<FieldErrors<AddressTextField>>({});
  const [failure, setFailure] = useState<Pick<ApiFailure, "status" | "code"> | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const isEdit = address !== null;
  const title = isEdit ? th.account.addresses.editTitle : th.account.addresses.addTitle;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setFormMessage(null);
    const result = validateAddressForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const response = isEdit
      ? await updateAddress(address.id, result.body)
      : await createAddress(result.body);
    setPending(false);
    if (response.ok) {
      onSaved(response.data, isEdit ? "updated" : "created");
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, ADDRESS_TEXT_FIELDS, addressServerMessage);
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.account.formInvalid);
      return;
    }
    if (response.code === "NOT_FOUND") onGone?.();
    setFailure(response);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="address-form-title">
      <CardTitle as="h2" size="panel" id="address-form-title">
        {title}
      </CardTitle>
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {failure ? <RequestError failure={failure} returnTo={ROUTES.accountAddresses} /> : null}
        {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
        {ADDRESS_TEXT_FIELDS.map((field, index) => {
          const extra = TEXT_FIELD_PROPS[field];
          return (
            <InputField
              key={field}
              ref={index === 0 ? firstRef : undefined}
              label={th.account.addresses.fields[field]}
              name={field}
              type={extra.type}
              inputMode={extra.inputMode}
              autoComplete={extra.autoComplete}
              value={values[field]}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field]: event.target.value }))
              }
              helperText={
                field === "phone"
                  ? th.account.addresses.phoneHelper
                  : field === "postalCode"
                    ? th.account.addresses.postalCodeHelper
                    : undefined
              }
              errorText={errors[field]}
              required
              disabled={pending}
            />
          );
        })}
        <Checkbox
          name="isDefault"
          label={th.account.addresses.isDefault}
          checked={values.isDefault}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, isDefault: event.target.checked }))
          }
          disabled={pending}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending}>
            {th.account.common.save}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            {th.account.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
