/**
 * Option colours for `select` / `multi-select` / `status`.
 *
 * The palette is the same set of names Notion exposes, stored by **name** rather
 * than hex so the rendering can change without rewriting every document. Values
 * outside the palette are passed through unchanged, because an option colour
 * written by a newer client is still displayable data.
 */

/** Palette names a user can pick from. */
export const OPTION_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type OptionColor = (typeof OPTION_COLORS)[number];

/**
 * Chip background colours, chosen dark enough for white text.
 *
 * Deliberately muted rather than the 500-weight Material colours: a table can show
 * dozens of chips at once, and saturated colours at that density are hard to read.
 */
const COLOR_HEX: Record<string, string> = {
  default: "#9e9e9e",
  gray: "#757575",
  brown: "#8d6e63",
  orange: "#ef6c00",
  yellow: "#c9a227",
  green: "#2e7d32",
  blue: "#1976d2",
  purple: "#7b1fa2",
  pink: "#c2185b",
  red: "#c62828",
};

const FALLBACK_HEX = COLOR_HEX.default;

/**
 * Hex for an option colour name.
 *
 * Accepts `undefined` (an option with no colour) and unknown names, both of which
 * fall back to the default rather than rendering an invisible chip.
 */
export function optionColorHex(color: string | undefined): string {
  if (!color) return FALLBACK_HEX;
  // A raw hex value is already usable.
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return COLOR_HEX[color] ?? FALLBACK_HEX;
}

/** Is this a recognised palette name? */
export function isKnownOptionColor(color: string): color is OptionColor {
  return (OPTION_COLORS as readonly string[]).includes(color);
}

/**
 * The next colour to suggest when adding options in sequence.
 *
 * Cycling through the non-default colours stops a freshly created option list from
 * reading as one grey block, which makes a board useful before the user has
 * coloured anything.
 */
export function suggestOptionColor(index: number): OptionColor {
  const palette = OPTION_COLORS.filter((color) => color !== "default");
  return palette[index % palette.length];
}

export type { OptionDef, PropertyDef } from "./types";
