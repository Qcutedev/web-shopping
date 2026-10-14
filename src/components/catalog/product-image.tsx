import Image from "next/image";
import { th } from "@/i18n/th";
import { cn } from "@/lib/utils";
import type { ImageRef } from "@/modules/catalog/schema";

/**
 * Square picture area, filled with a tint when there is no picture (docs/DESIGN_SYSTEM.md,
 * ProductCard). The file endpoint is the app's own, so the image is not sent through the
 * optimiser (`unoptimized`). `alt` is empty when the picture only repeats text beside it.
 */
export function ProductImage({
  image,
  alt,
  sizes,
  priority = false,
  className,
}: {
  image: ImageRef | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface-muted relative aspect-square w-full overflow-hidden rounded-lg",
        className,
      )}
    >
      {image === null ? (
        <span className="sr-only">{th.catalog.noImage}</span>
      ) : (
        <Image
          src={image.url}
          alt={alt}
          fill
          sizes={sizes}
          unoptimized
          priority={priority}
          className="object-cover"
        />
      )}
    </div>
  );
}
