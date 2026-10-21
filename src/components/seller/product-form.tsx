"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { TextareaField } from "@/components/ui/textarea";
import { th } from "@/i18n/th";
import type { ApiFailure } from "@/lib/api-client/http";
import { createProduct, updateProduct } from "@/lib/api-client/seller";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { type FieldErrors, messageForCode, serverFieldErrors } from "./form-validation";
import { ImageSetEditor } from "./image-set-editor";
import {
  EMPTY_PRODUCT_VALUES,
  PRODUCT_FIELDS,
  type ProductField,
  type ProductFormValues,
  validateCreate,
  validateEdit,
  valuesOfProduct,
} from "./product-form-model";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { SELLER_ROUTES, sellerProductHref } from "./routes";

export interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Create or edit a product (REQ-S-04, REQ-S-05). The form checks with the module's schema for
 * feedback only. Create sends everything and moves to the new product's page; edit sends only the
 * fields that changed and shows the server's product afterwards. The submit control is disabled
 * while a request is pending. `disabled` (archived product or suspended store) is a convenience;
 * the server refuses those writes either way.
 */
export function ProductForm({
  product,
  categories,
  disabled = false,
}: {
  /** Absent: create. Present: edit that product. */
  product?: SellerProductDto;
  categories: readonly CategoryOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SellerProductDto | undefined>(product);
  const [values, setValues] = useState<ProductFormValues>(
    product ? valuesOfProduct(product) : EMPTY_PRODUCT_VALUES,
  );
  const [errors, setErrors] = useState<FieldErrors<ProductField>>({});
  const [failure, setFailure] = useState<SellerFailure | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const returnTo = saved ? sellerProductHref(saved.id) : SELLER_ROUTES.newProduct;
  const locked = pending || disabled;

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function showServerFailure(response: ApiFailure) {
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, PRODUCT_FIELDS, (field, code) =>
        messageForCode(th.seller.fieldErrors[field], code),
      );
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    if (response.code === "CONFLICT" && response.reason === "DUPLICATE_SKU") {
      setErrors({ sku: th.seller.errors.reasons.DUPLICATE_SKU });
      return;
    }
    if (response.code === "CONFLICT" && response.reason === "CATEGORY_INACTIVE") {
      setErrors({ categoryId: th.seller.errors.reasons.CATEGORY_INACTIVE });
      return;
    }
    if (response.code === "SELLER_NOT_APPROVED" || response.code === "NOT_FOUND") router.refresh();
    setFailure(response);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setFailure(null);
    setFormMessage(null);
    setSuccess(null);

    if (saved === undefined) {
      const result = validateCreate(values);
      if (!result.ok) {
        setErrors(result.errors);
        if (result.unplaced) setFormMessage(th.seller.common.formInvalid);
        return;
      }
      setErrors({});
      setPending(true);
      const response = await createProduct(result.body);
      setPending(false);
      if (response.ok) {
        router.push(`${sellerProductHref(response.data.id)}?created=1`);
        return;
      }
      showServerFailure(response);
      return;
    }

    const result = validateEdit(saved, values);
    if (result.kind === "nochange") {
      setErrors({});
      setSuccess(th.seller.products.form.noChange);
      return;
    }
    if (!result.ok) {
      setErrors(result.errors);
      if (result.unplaced) setFormMessage(th.seller.common.formInvalid);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await updateProduct(saved.id, result.body);
    setPending(false);
    if (response.ok) {
      setSaved(response.data);
      setValues(valuesOfProduct(response.data));
      setSuccess(th.seller.products.form.saved);
      router.refresh();
      return;
    }
    showServerFailure(response);
  }

  // A category that was switched off after the product was filed stays selectable as it is.
  const options =
    saved !== undefined && !categories.some((category) => category.id === saved.category.id)
      ? [...categories, { ...saved.category }]
      : categories;

  return (
    <Card as="section" padding="panel" aria-labelledby="product-form-title">
      <CardTitle as="h2" size="panel" id="product-form-title">
        {saved ? th.seller.products.form.editTitle : th.seller.products.form.createTitle}
      </CardTitle>
      {saved ? (
        <p className="type-small text-foreground-muted mt-2">{th.seller.products.reviewNote}</p>
      ) : null}
      {success ? (
        <Alert tone="success" className="mt-4">
          {success}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {failure ? <SellerRequestError failure={failure} returnTo={returnTo} /> : null}
        {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
        <InputField
          label={th.seller.products.form.title}
          name="title"
          value={values.title}
          onChange={(event) => set("title", event.target.value)}
          errorText={errors.title}
          required
          disabled={locked}
        />
        <TextareaField
          label={th.seller.products.form.description}
          name="description"
          rows={6}
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          errorText={errors.description}
          required
          disabled={locked}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label={th.seller.products.form.sku}
            name="sku"
            value={values.sku}
            onChange={(event) => set("sku", event.target.value)}
            helperText={th.seller.products.form.skuHelper}
            errorText={errors.sku}
            autoComplete="off"
            required
            disabled={locked}
          />
          <SelectField
            label={th.seller.products.form.category}
            name="categoryId"
            value={values.categoryId}
            onChange={(event) => set("categoryId", event.target.value)}
            errorText={errors.categoryId}
            helperText={options.length === 0 ? th.seller.products.form.categoriesEmpty : undefined}
            required
            disabled={locked}
          >
            <option value="">{th.seller.products.form.categoryPlaceholder}</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.isActive
                  ? category.name
                  : `${category.name} ${th.seller.products.form.categoryInactive}`}
              </option>
            ))}
          </SelectField>
          <InputField
            label={th.seller.products.form.price}
            name="price"
            inputMode="decimal"
            autoComplete="off"
            value={values.price}
            onChange={(event) => set("price", event.target.value)}
            helperText={th.seller.products.form.priceHelper}
            errorText={errors.priceSatang}
            required
            disabled={locked}
          />
          {saved === undefined ? (
            <InputField
              label={th.seller.products.form.stock}
              name="stock"
              inputMode="numeric"
              autoComplete="off"
              value={values.stock}
              onChange={(event) => set("stock", event.target.value)}
              helperText={th.seller.products.form.stockHelper}
              errorText={errors.stock}
              required
              disabled={locked}
            />
          ) : null}
        </div>
        <ImageSetEditor
          label={th.seller.products.form.images}
          images={values.images}
          max={8}
          disabled={locked}
          returnTo={returnTo}
          onChange={(images) => set("images", images)}
        />
        {errors.imageKeys ? <Alert tone="danger">{errors.imageKeys}</Alert> : null}
        <div>
          <Button type="submit" loading={pending} disabled={disabled}>
            {saved ? th.seller.products.form.save : th.seller.products.form.create}
          </Button>
        </div>
      </form>
    </Card>
  );
}
