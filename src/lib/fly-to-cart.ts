/**
 * Decorative: a copy of the product picture flies from the product page to the header cart and
 * the cart pulses. It uses the Web Animations API on a throw-away element, so it touches no React
 * state and changes nothing the server owns. Does nothing when the picture or the cart link is
 * not on the page. It keeps running when the visitor asked for reduced motion (owner choice, as
 * for the poster); it lasts well under a second.
 */
const FLIGHT_MS = 650;

export function flyToCart(): void {
  if (typeof document === "undefined") return;
  const source = document.querySelector<HTMLImageElement>("[data-fly-source] img");
  const target = document.querySelector<HTMLElement>("[data-fly-to]");
  if (source === null || target === null || typeof source.animate !== "function") return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return;

  const size = Math.min(from.width, from.height, 160);
  const clone = document.createElement("div");
  clone.setAttribute("aria-hidden", "true");
  clone.style.cssText = [
    "position:fixed",
    "z-index:9999",
    "pointer-events:none",
    `left:${from.left + from.width / 2 - size / 2}px`,
    `top:${from.top + from.height / 2 - size / 2}px`,
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:9999px",
    `background:center / cover no-repeat url("${source.currentSrc || source.src}")`,
    "box-shadow:0 8px 24px rgb(0 0 0 / 0.25)",
  ].join(";");
  document.body.append(clone);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = clone.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(0.6)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.4 },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0.4)" },
  );
  const finish = () => {
    clone.remove();
    target.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
      { duration: 350, easing: "ease-out" },
    );
  };
  flight.addEventListener("finish", finish, { once: true });
  flight.addEventListener("cancel", () => clone.remove(), { once: true });
}
