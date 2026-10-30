import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconName =
  | "shirt"
  | "shoe"
  | "plug"
  | "home"
  | "cup"
  | "sparkle"
  | "ball"
  | "glasses"
  | "laptop"
  | "phone"
  | "tag";

/** Thai keywords of a category name -> icon. The first match wins; anything else gets the tag. */
const KEYWORDS: readonly (readonly [IconName, readonly string[]])[] = [
  ["shoe", ["รองเท้า"]],
  ["laptop", ["คอมพิวเตอร์", "โน้ตบุ๊ก", "โน๊ตบุ๊ก"]],
  ["phone", ["มือถือ", "แท็บเล็ต", "สมาร์ตโฟน"]],
  ["glasses", ["เครื่องประดับ", "แว่น", "นาฬิกา"]],
  ["sparkle", ["ความงาม", "สกินแคร์", "เครื่องสำอาง"]],
  ["ball", ["กีฬา", "ฟิตเนส"]],
  ["cup", ["อาหาร", "เครื่องดื่ม", "ขนม"]],
  ["home", ["บ้าน", "เฟอร์นิเจอร์", "ครัว"]],
  ["plug", ["อิเล็กทรอนิกส์", "ไอที", "แกดเจ็ต"]],
  ["shirt", ["เสื้อ", "แฟชั่น", "กระเป๋า"]],
];

export function categoryIconName(categoryName: string): IconName {
  for (const [name, words] of KEYWORDS) {
    if (words.some((word) => categoryName.includes(word))) return name;
  }
  return "tag";
}

const PATHS: Record<IconName, ReactNode> = {
  shirt: <path d="M8 3 3 6l2 4 3-1v11h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0Z" />,
  shoe: (
    <>
      <path d="M3 16v-3c3 0 5-2 6-5l2 2c1 1.5 2.5 2 4 2.3L20 13c1 .3 1.5 1 1.5 2v1Z" />
      <path d="M3 19h18.5M12.5 11.5l1.5-2" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0Z" />
      <path d="M12 17v4" />
    </>
  ),
  home: <path d="m3 11 9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" />,
  cup: (
    <>
      <path d="M5 8h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z" />
      <path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5c0 1.2 1 1.3 1 2.5M12 3.5c0 1.2 1 1.3 1 2.5M6 21h10" />
    </>
  ),
  sparkle: (
    <>
      <path d="M10 3c.7 4.3 2.7 6.3 7 7-4.3.7-6.3 2.7-7 7-.7-4.3-2.7-6.3-7-7 4.3-.7 6.3-2.7 7-7Z" />
      <path d="M19 15v6M16 18h6" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  glasses: (
    <>
      <circle cx="6.5" cy="14" r="3.5" />
      <circle cx="17.5" cy="14" r="3.5" />
      <path d="M10 14h4M3 14 5 6M21 14 19 6" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M2.5 19h19l-2-4h-15Z" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4h8l10 10-8 8Z" />
      <circle cx="7.5" cy="8.5" r="1.2" />
    </>
  ),
};

/** Decorative line icon for a category. The category's name next to it is the accessible name. */
export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8", className)}
    >
      {PATHS[categoryIconName(name)]}
    </svg>
  );
}
