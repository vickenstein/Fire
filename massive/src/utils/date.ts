/**
 * Generate an array of trading dates (weekdays) between start and end, inclusive.
 * Does not exclude market holidays — missing S3 files on holidays are handled gracefully.
 */
export function getTradingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate + "T12:00:00Z"); // noon UTC avoids DST edge cases
  const end = new Date(endDate + "T12:00:00Z");

  while (current <= end) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      days.push(formatDate(current));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

/** Format a Date to YYYY-MM-DD string (UTC). */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
