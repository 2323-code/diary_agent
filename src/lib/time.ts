export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type JstDateParts = {
  year: number;
  month: number;
  day: number;
};

export function toJstDate(date = new Date()): Date {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

export function getJstDateParts(date = new Date()): JstDateParts {
  const jst = toJstDate(date);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

export function formatJstDate(date = new Date()): string {
  const { year, month, day } = getJstDateParts(date);
  return `${year}年${String(month).padStart(2, "0")}月${String(day).padStart(2, "0")}日`;
}

export function formatJstMonth(year: number, month: number): string {
  return `${year}年${month}月`;
}

export function formatJstTime(date: Date): string {
  const jst = toJstDate(date);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export function addJstDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function jstDayRangeAsUtc(date = new Date()): { start: Date; end: Date } {
  const { year, month, day } = getJstDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function monthRangeJstAsUtc(
  year: number,
  month: number,
): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS);
  const end = new Date(
    Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) -
      JST_OFFSET_MS,
  );
  return { start, end };
}

export function millisecondsUntilNextJst(
  hour: number,
  minute: number,
  now = new Date(),
): number {
  const jst = toJstDate(now);
  const next = new Date(
    Date.UTC(
      jst.getUTCFullYear(),
      jst.getUTCMonth(),
      jst.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );

  if (next.getTime() <= jst.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - jst.getTime();
}

export function isLastDayOfMonthJst(date = new Date()): boolean {
  const jst = toJstDate(date);
  const tomorrow = new Date(jst);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.getUTCMonth() !== jst.getUTCMonth();
}
