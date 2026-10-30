"use client";

import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface HeroProduct {
  title: string;
  href: string;
  imageUrl: string;
}

export interface HeroSlide {
  kicker: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  /** Up to three real products shown floating on the poster. May be empty. */
  products: readonly HeroProduct[];
}

export interface HeroCarouselLabels {
  region: string;
  previous: string;
  next: string;
  pause: string;
  play: string;
  /** Contains `{number}`. */
  goTo: string;
  /** Contains `{number}` and `{total}`. */
  slideOf: string;
  badge: string;
  presenterAlt: string;
}

const AUTOPLAY_MS = 6500;

const ROUND_BUTTON =
  "focus-ring flex size-11 items-center justify-center rounded-full border border-border-contrast bg-surface text-foreground transition-colors duration-150 hover:border-control-border-hover";

/**
 * Poster carousel for the home page. Every slide has a tinted stage: real products float on it
 * (they link to their pages), an optional presenter picture stands in the middle, and the layers
 * follow the pointer a little. Slides cross-fade, the active slide's text rises in, and the shapes
 * drift (CSS only, see `hero-*` in globals.css). All of this stays on even when the visitor asked
 * for reduced motion (owner choice). Autoplay stops while the pointer or focus is inside and can
 * be paused with a button (WCAG 2.2.2). Inactive slides are `inert`, so only the visible one is reachable.
 */
export function HeroCarousel({
  slides,
  labels,
  presenterSrc,
}: {
  slides: readonly HeroSlide[];
  labels: HeroCarouselLabels;
  /** Path of a presenter picture (transparent PNG works best), or null for none. */
  presenterSrc: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovering, setHovering] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const count = slides.length;

  // The poster keeps its motion and autoplay for visitors who asked for reduced motion (owner
  // choice, see globals.css); the pause button stays available for them (WCAG 2.2.2).
  const running = playing && !hovering && count > 1;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [running, index, count]);

  const go = useCallback((to: number) => setIndex((to + count) % count), [count]);

  // The pointer position (-1..1 on each axis) goes to CSS variables; no React state, no re-render.
  const follow = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (!root || event.pointerType !== "mouse") return;
    const box = root.getBoundingClientRect();
    root.style.setProperty("--px", String(((event.clientX - box.left) / box.width - 0.5) * 2));
    root.style.setProperty("--py", String(((event.clientY - box.top) / box.height - 0.5) * 2));
  }, []);

  if (count === 0) return null;

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label={labels.region}
      className="hero-motion text-foreground bg-surface-muted @container relative h-full overflow-hidden"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onPointerMove={follow}
      onFocus={() => setHovering(true)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setHovering(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") go(index - 1);
        if (event.key === "ArrowRight") go(index + 1);
      }}
    >
      <div className="relative grid">
        {slides.map((slide, i) => {
          const active = i === index;
          return (
            <div
              key={slide.kicker}
              role="group"
              aria-roledescription="slide"
              aria-label={labels.slideOf
                .replace("{number}", String(i + 1))
                .replace("{total}", String(count))}
              aria-hidden={active ? undefined : true}
              inert={!active}
              data-active={active}
              data-tone={i % 3}
              className="hero-slide col-start-1 row-start-1 overflow-hidden"
            >
              <div className="mx-auto grid max-w-[90rem] @xl:grid-cols-2">
                <div className="relative z-10 flex flex-col items-start justify-center gap-4 px-6 pt-10 pb-4 @xl:px-14 @xl:py-16 @xl:pb-20">
                  <p className="hero-rise type-label bg-surface text-primary-active border-border rounded-full border px-3 py-1">
                    {slide.kicker}
                  </p>
                  <h2
                    className="hero-rise type-hero @max-4xl:text-4xl"
                    style={{ animationDelay: "80ms" }}
                  >
                    {slide.title}
                  </h2>
                  <p
                    className="hero-rise text-foreground-secondary max-w-md text-base"
                    style={{ animationDelay: "160ms" }}
                  >
                    {slide.description}
                  </p>
                  <Link
                    href={slide.href}
                    className="hero-rise focus-ring on-ink bg-ink text-on-ink type-label hover:bg-ink-hover inline-flex min-h-11 items-center gap-1.5 rounded-full px-6 transition-transform duration-150 hover:scale-[1.04]"
                    style={{ animationDelay: "240ms" }}
                  >
                    {slide.cta}
                    <ChevronRightIcon />
                  </Link>
                </div>

                <div
                  className="hero-stage relative min-h-72 @xl:min-h-[26rem]"
                  data-presenter={presenterSrc !== null}
                >
                  <span aria-hidden="true" className="hero-blob" />
                  <span aria-hidden="true" className="hero-ring" />
                  <span aria-hidden="true" className="hero-ring hero-ring-b" />
                  {presenterSrc === null ? null : (
                    <div className="hero-presenter">
                      <Image
                        src={presenterSrc}
                        alt={labels.presenterAlt}
                        fill
                        sizes="(min-width: 768px) 30vw, 60vw"
                        priority={i === 0}
                        className="object-contain object-bottom"
                      />
                    </div>
                  )}
                  {slide.products.slice(0, 3).map((product, k) => (
                    <div
                      key={product.href}
                      className={`hero-layer hero-layer-${k}`}
                      style={{ "--depth": 10 + k * 8 } as CSSProperties}
                    >
                      <div className="hero-pop" style={{ animationDelay: `${250 + k * 150}ms` }}>
                        <Link
                          href={product.href}
                          aria-label={product.title}
                          className={cn(
                            "hero-product focus-ring bg-surface relative block overflow-hidden rounded-lg p-1.5",
                            `hero-bob-${k}`,
                          )}
                        >
                          <span className="bg-surface-muted relative block aspect-square overflow-hidden rounded-md">
                            <Image
                              src={product.imageUrl}
                              alt=""
                              fill
                              sizes="160px"
                              unoptimized
                              priority={i === 0}
                              className="object-cover"
                            />
                          </span>
                        </Link>
                      </div>
                    </div>
                  ))}
                  <span
                    aria-hidden="true"
                    className="hero-badge bg-primary text-on-primary type-label"
                  >
                    {labels.badge}
                  </span>
                  <span aria-hidden="true" className="hero-shine" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <span
          key={index}
          aria-hidden="true"
          className="hero-progress"
          style={{
            animationDuration: `${AUTOPLAY_MS}ms`,
            animationPlayState: running ? "running" : "paused",
          }}
        />
      ) : null}

      <div className="absolute inset-x-0 bottom-0 pb-4">
        <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-3 px-6 @xl:px-14">
          {/* -ml-1.5 cancels the 6px padding around the first dot, so it lines up with the text. */}
          <div className="-ml-1.5 flex items-center gap-1">
            {slides.map((slide, i) => (
              <button
                key={slide.kicker}
                type="button"
                aria-label={labels.goTo.replace("{number}", String(i + 1))}
                aria-current={i === index ? "true" : undefined}
                onClick={() => go(i)}
                className="focus-ring group flex size-11 items-center justify-center rounded-full"
              >
                <span
                  className={cn(
                    "bg-ink block h-2 rounded-full transition-all duration-300",
                    i === index ? "w-8" : "w-2 opacity-40 group-hover:opacity-70",
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={labels.previous}
              onClick={() => go(index - 1)}
              className={ROUND_BUTTON}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              aria-label={labels.next}
              onClick={() => go(index + 1)}
              className={ROUND_BUTTON}
            >
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              aria-label={playing ? labels.pause : labels.play}
              aria-pressed={!playing}
              onClick={() => setPlaying((value) => !value)}
              className={ROUND_BUTTON}
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
                {playing ? <path d="M6 4h3v12H6zM11 4h3v12h-3z" /> : <path d="M6 4l10 6-10 6z" />}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
