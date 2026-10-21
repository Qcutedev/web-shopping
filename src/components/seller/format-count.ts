/** A count for display: Thai digits grouping, for example 1,234. Not for money (use <Price>). */
export function formatCount(count: number): string {
  return count.toLocaleString("th-TH");
}
