import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { getOwnProduct } from "@/modules/inventory";
import { productIdParamsSchema } from "@/modules/inventory/schema";
import { notFound } from "@/server/errors";
import { SellerNotFoundState } from "./load-state";
import { ProductDetailView } from "./product-detail-view";
import { type CategoryOption, ProductForm } from "./product-form";
import { SELLER_ROUTES, sellerProductHref } from "./routes";
import { renderForSeller } from "./with-seller";
import { th } from "@/i18n/th";

type SearchParams = Record<string, string | string[] | undefined>;

/** The categories a seller may file a product in: the active ones (REQ-S-04, BR-23). */
async function loadCategoryOptions(): Promise<CategoryOption[]> {
  const categories = await listAllActiveCategories();
  return categories.map((category) => ({ id: category.id, name: category.name, isActive: true }));
}

/** Server Component: the create form with the active categories. Behind a Suspense boundary. */
export async function NewProductSection() {
  return renderForSeller(SELLER_ROUTES.newProduct, async (actor) => {
    const categories = await loadCategoryOptions();
    return <ProductForm categories={categories} disabled={actor.storeStatus !== "APPROVED"} />;
  });
}

/**
 * Server Component: one of the session's store's products through the module service. Another
 * store's id, an unknown id, and a deleted product all answer 404 and show the same message.
 */
export async function ProductDetailSection({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const created = (await searchParams).created === "1";
  const returnTo = sellerProductHref(id);
  return renderForSeller(
    returnTo,
    async (actor) => {
      // An id that cannot be one (NUL, too long) is the same not-found as an unknown id.
      const parsed = productIdParamsSchema.safeParse({ id });
      if (!parsed.success) throw notFound();
      const [product, categories] = await Promise.all([
        getOwnProduct(actor, parsed.data.id),
        loadCategoryOptions(),
      ]);
      return (
        <ProductDetailView
          product={product}
          categories={categories}
          suspended={actor.storeStatus !== "APPROVED"}
          created={created}
        />
      );
    },
    {
      notFound: (
        <SellerNotFoundState
          backHref={SELLER_ROUTES.products}
          backLabel={th.seller.products.backToList}
        />
      ),
    },
  );
}
