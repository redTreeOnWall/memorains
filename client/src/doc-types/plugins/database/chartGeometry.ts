/**
 * Axis scales, band positions and pie geometry for the chart view.
 *
 * Pure maths with no React and no SVG: the chart component turns these numbers into
 * attributes. Kept separate for the same reason `ganttScale.ts` is: geometry that looks
 * right in one place and off by a pixel in another is how a chart ends up with bars that
 * do not meet their gridlines, and numbers are cheap to test exhaustively.
 */

/** A rounded axis: the domain it covers and the round values it is divided at. */
export interface NiceScale {
  min: number;
  max: number;
  /** Tick values, ascending, always including the domain's ends. */
  ticks: number[];
}

/** A tick count that leaves room for a label without crowding the axis. */
const DEFAULT_TICKS = 5;

/**
 * The classic "nice numbers" rounding: a step that is 1, 2, 5 or 10 times a power of ten.
 *
 * Labels on such a step are the ones a reader can hold in their head ("0, 20, 40"),
 * and because the step is a single digit times a power of ten, the label of a tick is
 * exact in decimal — `0.1` and `0.2` rather than `0.30000000000000004`.
 */
function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  const niceFraction = round
    ? fraction < 1.5
      ? 1
      : fraction < 3
        ? 2
        : fraction < 7
          ? 5
          : 10
    : fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 5
          ? 5
          : 10;
  return niceFraction * 10 ** exponent;
}

/**
 * A rounded axis covering `[0, max]` (or `[min, 0]`, or both when values go negative).
 *
 * **Zero is always in the domain.** A bar's length is its value, so a truncated axis
 * draws a bar twice as long for a value twice as large — the correct relationship only
 * holds when the baseline is the same for every bar. The same truncation moves a line
 * chart's apparent differences by an arbitrary factor, so sharing the rule keeps the
 * two charts telling the same story.
 *
 * An all-zero or all-equal dataset still needs a visible axis: `max` and `min` are
 * widened to non-degenerate ends before rounding, so the ticks do not collapse to a
 * single repeated label.
 */
export function niceScale(
  values: readonly number[],
  tickCount: number = DEFAULT_TICKS,
): NiceScale {
  const finite = values.filter((value) => Number.isFinite(value));
  let dataMin = finite.length ? Math.min(...finite) : 0;
  let dataMax = finite.length ? Math.max(...finite) : 0;

  // Bars grow upwards from zero, so the domain reaches it whether or not the data does.
  dataMin = Math.min(0, dataMin);
  dataMax = Math.max(0, dataMax);
  if (dataMin === 0 && dataMax === 0) dataMax = 1;

  const ticks = Math.max(2, Math.floor(tickCount));
  const range = niceNum(dataMax - dataMin, false);
  const step = niceNum(range / (ticks - 1), true);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step;

  const result: number[] = [];
  // Accumulating `min + i * step` keeps a float step from drifting; `i <= count` guards
  // against the division's rounding adding a tick past `max`.
  const count = Math.round((max - min) / step);
  for (let index = 0; index <= count; index++) {
    result.push(Number((min + index * step).toPrecision(12)));
  }
  return { min, max, ticks: result };
}

/**
 * Y position of a value inside a plot `height` pixels tall.
 *
 * SVG's y grows downwards and an axis grows upwards, so the scale is flipped here once
 * rather than at every call site. `max === min` cannot happen for a scale built by
 * `niceScale`, but a degenerate domain collapses to the baseline rather than dividing by
 * zero.
 */
export function scaleY(
  value: number,
  min: number,
  max: number,
  height: number,
): number {
  if (max === min) return height;
  return height - ((value - min) / (max - min)) * height;
}

/** Position and size of one category slot on a band axis. */
export interface Band {
  x: number;
  width: number;
  center: number;
}

/**
 * Divide a width into equal category slots.
 *
 * `gapRatio` is the share of a slot left empty between neighbours, so bars in different
 * groups cannot touch. Each band is inset symmetrically, which is what keeps a bar
 * centred over its tick rather than starting on it.
 */
export function bands(count: number, width: number, gapRatio = 0.3): Band[] {
  if (count <= 0 || width <= 0) return [];
  const slot = width / count;
  const gap = slot * Math.min(Math.max(gapRatio, 0), 0.9);
  const barWidth = Math.max(1, slot - gap);
  return Array.from({ length: count }, (_unused, index) => ({
    x: index * slot + gap / 2,
    width: barWidth,
    center: index * slot + slot / 2,
  }));
}

/**
 * A slice of a pie: its share of the whole and the angles it covers.
 *
 * Angles are radians measured **clockwise from twelve o'clock**, which is how a pie is
 * read; the conversion to screen coordinates happens in `polar`.
 */
export interface PieSlice {
  /** Fraction of the whole, in `[0, 1]`. */
  fraction: number;
  startAngle: number;
  endAngle: number;
}

/**
 * Convert values to consecutive slices.
 *
 * Only **positive** values take up an arc: a pie's slice is a share of a whole, and a
 * negative share is not a thing a reader can interpret (a total that mixes signs can
 * even be zero, which no set of proportions can represent). What is not drawable is
 * reported by the caller — the pie chart says so rather than silently drawing an
 * arbitrary picture.
 *
 * A total of zero produces no slices at all.
 */
export function pieSlices(values: readonly number[]): PieSlice[] {
  const total = values.reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0,
  );
  if (total <= 0) return [];
  let angle = 0;
  return values.map((value) => {
    const positive = Number.isFinite(value) && value > 0 ? value : 0;
    const fraction = positive / total;
    const startAngle = angle;
    angle += fraction * Math.PI * 2;
    return { fraction, startAngle, endAngle: angle };
  });
}

/** A point on a circle, `angle` radians clockwise from twelve o'clock. */
function polar(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  // Rounded to a thousandth of a pixel: far below anything a screen can show, and it
  // keeps `cos(π/2)` printing as `0` rather than as `6.1e-17` in every path.
  const round = (value: number) => {
    const snapped = Math.round(value * 1000) / 1000;
    return Object.is(snapped, -0) ? 0 : snapped;
  };
  return {
    x: round(cx + radius * Math.sin(angle)),
    y: round(cy - radius * Math.cos(angle)),
  };
}

/**
 * SVG path for one slice: a wedge from the centre out along its two radii.
 *
 * A slice covering the **whole** circle is drawn as two half-arcs. An SVG arc whose two
 * endpoints are equal is defined to draw nothing, so the obvious one-arc path renders a
 * blank chart exactly in the case that matters most — a filter leaving one category,
 * which is a one-slice pie at 100%.
 */
export function pieArcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const start = polar(cx, cy, radius, startAngle);

  if (sweep >= Math.PI * 2 - 1e-9) {
    const opposite = polar(cx, cy, radius, startAngle + Math.PI);
    return [
      `M ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${opposite.x} ${opposite.y}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${start.x} ${start.y}`,
      "Z",
    ].join(" ");
  }

  const end = polar(cx, cy, radius, endAngle);
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}
