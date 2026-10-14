import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductDetailSection } from "@/components/catalog/product-detail-section";
import { ProductDetailSkeleton } from "@/components/catalog/product-detail-view";
import { slugParamsSchema } from "@/modules/catalog/schema";

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="container-page py-6 md:py-8">
      <Suspense fallback={<ProductDetailSkeleton />}>
        <ProductContent params={params} />
      </Suspense>
    </div>
  );
}

async function ProductContent({ params }: { params: Promise<{ slug: string }> }) {
  const parsed = slugParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <ProductDetailSection slug={parsed.data.slug} />;
}
