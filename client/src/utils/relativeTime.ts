/**
 * Human-readable relative times ("2 hours ago", "3 天前").
 *
 * A module of its own, and pure, for the same reason `localDate.ts` is: the app's
 * `utils.ts` pulls in the router, IndexedDB and the document-type registry, and
 * cannot be imported by the node test environment. The formatting rules are the
 * part worth testing, so they live where a test can reach them.
 *
 * ## Why `Intl` rather than `moment`
 *
 * `moment/locale/zh-cn` registers its locale on the copy of moment that the bundler
 * builds for that import path — a different instance from the one the app formats
 * with. `moment.locale("zh-cn")` therefore returned `"en"` and every relative time
 * stayed English no matter what the UI language was. `Intl.RelativeTimeFormat` has
 * no such split, and is what `journalDays.ts` already uses for month and weekday
 * names.
 */

/**
 * Units from coarsest to finest, with the length each one is measured in.
 *
 * Ordered so the first unit the elapsed time reaches is the one reported: 90
 * minutes is "1 hour ago", not "90 minutes ago".
 */
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * Relative time for a timestamp, in the given locale.
 *
 * `locale` is a BCP-47 tag. `now` is injectable so a test can pin the clock rather
 * than assert against a moving one.
 */
export function relativeTime(
  timestamp: number | Date | string,
  locale: string,
  now: number = Date.now(),
): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsed = new Date(timestamp).getTime() - now;

  for (const [unit, milliseconds] of UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return formatter.format(Math.round(elapsed / milliseconds), unit);
    }
  }

  return formatter.format(Math.round(elapsed / 1000), "second");
}
