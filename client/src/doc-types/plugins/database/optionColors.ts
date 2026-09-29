/**
 * Option colours for `select` / `multi-select` / `status`.
 *
 * A curated palette is stored by **name** rather than hex, so the rendering can change
 * without rewriting every document. A user's own pick is stored as the raw hex, because
 * there is no name for it — and both forms resolve through `optionColorHex`, so nothing
 * downstream needs to know which it got.
 */
import type { I18nKey } from "../../../internationnalization/utils";

/** Lightness tiers, in the order they are shown. */
export const COLOR_TIERS = ["macaron", "vivid", "deep"] as const;
export type ColorTier = (typeof COLOR_TIERS)[number];

/** i18n keys for the tier headings. */ export const TIER_LABEL_KEYS: Record<
  ColorTier,
  I18nKey
> = {
  macaron: "db_color_macaron",
  vivid: "db_color_vivid",
  deep: "db_color_deep",
};

/**
 * A hue at each lightness tier.
 *
 * `deep` keeps the original palette's bare names (`gray`, `blue`, …) so existing
 * documents need no migration.
 */
interface ColorHue {
  /** The hue's name, used to build the tier-qualified palette names. */
  hue: string;
  /**
   * The name older documents stored. Only the deep tier has these, and only so that
   * options coloured before the tiers existed keep their exact colour.
   */
  legacyName?: string;
  macaron: string;
  vivid: string;
  deep: string;
}

/**
 * The hues, each at three weights.
 *
 * The macaron column is the default: desaturated and slightly cool, the sort of palette
 * that reads as considered rather than as a highlighter. Saturation is kept low (around
 * 35–55%) and lightness high (80–88%), which is what stops ten chips in a table from
 * fighting each other and keeps dark ink legible on every one.
 */
const HUES: readonly ColorHue[] = [
  {
    hue: "gray",
    macaron: "#dfe1e6",
    vivid: "#9aa0a6",
    deep: "#757575",
    legacyName: "gray",
  },
  {
    hue: "brown",
    macaron: "#e3cfc4",
    vivid: "#b08968",
    deep: "#8d6e63",
    legacyName: "brown",
  },
  {
    hue: "red",
    macaron: "#f6c6ce",
    vivid: "#ef5350",
    deep: "#c62828",
    legacyName: "red",
  },
  {
    hue: "orange",
    macaron: "#fbdcbd",
    vivid: "#ff8f3f",
    deep: "#ef6c00",
    legacyName: "orange",
  },
  {
    hue: "yellow",
    macaron: "#f7e7b0",
    vivid: "#f2c14e",
    deep: "#c9a227",
    legacyName: "yellow",
  },
  {
    hue: "green",
    macaron: "#c8e6c9",
    vivid: "#58c26b",
    deep: "#2e7d32",
    legacyName: "green",
  },
  {
    hue: "teal",
    macaron: "#c2e4e2",
    vivid: "#3fb8af",
    deep: "#00796b",
    legacyName: "teal",
  },
  {
    hue: "blue",
    macaron: "#c5daf5",
    vivid: "#4d96ff",
    deep: "#1976d2",
    legacyName: "blue",
  },
  {
    hue: "purple",
    macaron: "#d5cdee",
    vivid: "#9b5de5",
    deep: "#7b1fa2",
    legacyName: "purple",
  },
  {
    hue: "pink",
    macaron: "#f5cbdd",
    vivid: "#ec5f9b",
    deep: "#c2185b",
    legacyName: "pink",
  },
];

/**
 * The original palette's neutral, shown by no tier but still resolvable by name.
 *
 * It duplicates the grey hue above, so giving it a column would put a redundant second
 * grey at the bottom of the deep tier. Existing documents still name it, so it resolves.
 */
const LEGACY_NEUTRAL = { name: "default", hex: "#9e9e9e" };

/** A palette swatch: the value to store, and the tier it belongs to. */
export interface ColorSwatch {
  /** Stored on the option. The deep tier keeps the legacy bare names. */
  name: string;
  hex: string;
  tier: ColorTier;
}

/**
 * The palette, one column per tier. `COLOR_COLUMNS[t][i]` is hue `i` at tier `t`.
 */
export const COLOR_COLUMNS: readonly (readonly ColorSwatch[])[] =
  COLOR_TIERS.map((tier) =>
    HUES.map((hue) => ({
      name: tier === "deep" ? hue.legacyName! : `${tier}-${hue.hue}`,
      hex: hue[tier],
      tier,
    })),
  );

/** Name → hex: every swatch, plus the legacy neutral that is shown nowhere. */
const NAME_TO_HEX: Record<string, string> = Object.fromEntries([
  ...COLOR_COLUMNS.flatMap((column) =>
    column.map((swatch) => [swatch.name, swatch.hex] as const),
  ),
  [LEGACY_NEUTRAL.name, LEGACY_NEUTRAL.hex] as const,
]);

/** Every palette name a document may hold. */
export const OPTION_COLORS: readonly string[] = Object.keys(NAME_TO_HEX);

export type OptionColor = string;

/** The swatch for an option that was never given a colour: the macaron grey. */
const FALLBACK_HEX = "#dfe1e6";

/**
 * Expand `#abc` / `#aabbcc` / `#aabbccdd` to `#rrggbb`, or `null`.
 */
function normalizeHex(value: string): string | null {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits
      .slice(0, 3)
      .split("")
      .map((d) => d + d)
      .join("")}`;
  }
  if (digits.length === 6 || digits.length === 8) {
    return `#${digits.slice(0, 6)}`;
  }
  return null;
}

/**
 * Hex for an option colour, whether it is a palette name or a user's own pick.
 *
 * Accepts `undefined` (an option with no colour) and unknown names, both of which fall
 * back to the default rather than rendering an invisible chip.
 */
export function optionColorHex(color: string | undefined): string {
  if (!color) return FALLBACK_HEX;
  // A user's own colour is stored as the value itself.
  const asHex = normalizeHex(color);
  if (asHex) return asHex;
  return NAME_TO_HEX[color] ?? FALLBACK_HEX;
}

/** Is this a recognised palette name (as opposed to a custom hex)? */
export function isKnownOptionColor(color: string): boolean {
  return color in NAME_TO_HEX;
}

const srgbToLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** WCAG relative luminance, used to decide whether a swatch needs light or dark ink. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/** Mix a colour towards black, keeping its hue. */
export function shadeHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const to = (channel: number) => Math.round(channel * (1 - amount));
  return `#${[to(r), to(g), to(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** `#rrggbb` as an `rgba()` string. */
export function alphaHex(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Ink that reads on a given fill: white on dark, a darkened version of the fill's own
 * hue on light. Darkening the hue keeps pastel chips looking deliberate.
 */
export function contrastInk(hex: string): string {
  // 0.55 lands between the macaron tier (0.5–0.75) and the deep tier (below 0.2), so the
  // two ends of the palette each get the ink that suits them.
  if (luminance(hex) > 0.55) return shadeHex(hex, 0.62);
  return "#ffffff";
}

/**
 * Shared look for an option chip, wherever one is rendered, so a value reads identically
 * in a table cell, a board card, a list line and the options editor.
 */
export function optionChipSx(color: string | undefined) {
  const hex = optionColorHex(color);
  return {
    backgroundColor: hex,
    border: "1px solid",
    borderColor: alphaHex(shadeHex(hex, 0.4), 0.35),
    color: contrastInk(hex),
    height: 22,
    fontSize: "0.75rem",
    fontWeight: 500,
    borderRadius: "6px",
    "& .MuiChip-label": { px: 0.75, lineHeight: 1.2 },
  } as const;
}

/**
 * The next colour to suggest when adding options in sequence. Walks the macaron column,
 * the palette's default: it is the tier that stays readable when a table holds dozens of
 * chips at once, which is the situation the suggestion is for.
 */
export function suggestOptionColor(index: number): OptionColor {
  const column =
    COLOR_COLUMNS[COLOR_TIERS.indexOf("macaron")] ?? COLOR_COLUMNS[0];
  return column[index % column.length].name;
}

export type { OptionDef, PropertyDef } from "./types";
