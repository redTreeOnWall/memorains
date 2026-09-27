import type { IconComponent } from "../../pluginTypes";
import { i18n, type I18nKey } from "../../../internationnalization/utils";
import {
  isOptionPropType,
  isTextPropType,
  type PropType,
  type PropertyDef,
} from "./types";
import AbcRoundedIcon from "@mui/icons-material/AbcRounded";
import NumbersRoundedIcon from "@mui/icons-material/NumbersRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import ArrowDropDownCircleRoundedIcon from "@mui/icons-material/ArrowDropDownCircleRounded";
import ListRoundedIcon from "@mui/icons-material/ListRounded";
import CircleRoundedIcon from "@mui/icons-material/CircleRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import TitleRoundedIcon from "@mui/icons-material/TitleRounded";

/**
 * Registry of property types.
 *
 * Each type's label, icon and capabilities are declared **once** here, so no view
 * contains a `switch (propType)`. Views ask this registry what a property can do
 * (can it be grouped by? does it hold text?) rather than deciding for themselves.
 *
 * The registry deliberately holds *metadata only*. How a value is rendered and
 * edited lives in `cells/`, because those are React components that need the
 * binding, and keeping them out of here lets this module be imported by pure code
 * (filters, export) without pulling in the component tree.
 */

export interface PropertyTypeMeta {
  type: PropType;
  labelKey: I18nKey;
  Icon: IconComponent;
  /** Accent colour for the type icon in menus and headers. */
  color: string;
  /** One-line hint shown in the type picker. */
  hintKey: I18nKey;
}

const META: Record<PropType, PropertyTypeMeta> = {
  title: {
    type: "title",
    labelKey: "db_prop_title",
    Icon: TitleRoundedIcon,
    color: "#1976d2",
    hintKey: "db_prop_title_hint",
  },
  text: {
    type: "text",
    labelKey: "db_prop_text",
    Icon: AbcRoundedIcon,
    color: "#0288d1",
    hintKey: "db_prop_text_hint",
  },
  number: {
    type: "number",
    labelKey: "db_prop_number",
    Icon: NumbersRoundedIcon,
    color: "#7b1fa2",
    hintKey: "db_prop_number_hint",
  },
  checkbox: {
    type: "checkbox",
    labelKey: "db_prop_checkbox",
    Icon: CheckBoxRoundedIcon,
    color: "#2e7d32",
    hintKey: "db_prop_checkbox_hint",
  },
  url: {
    type: "url",
    labelKey: "db_prop_url",
    Icon: LinkRoundedIcon,
    color: "#455a64",
    hintKey: "db_prop_url_hint",
  },
  email: {
    type: "email",
    labelKey: "db_prop_email",
    Icon: EmailRoundedIcon,
    color: "#455a64",
    hintKey: "db_prop_email_hint",
  },
  phone: {
    type: "phone",
    labelKey: "db_prop_phone",
    Icon: PhoneRoundedIcon,
    color: "#455a64",
    hintKey: "db_prop_phone_hint",
  },
  select: {
    type: "select",
    labelKey: "db_prop_select",
    Icon: ArrowDropDownCircleRoundedIcon,
    color: "#e65100",
    hintKey: "db_prop_select_hint",
  },
  "multi-select": {
    type: "multi-select",
    labelKey: "db_prop_multi_select",
    Icon: ListRoundedIcon,
    color: "#ad1457",
    hintKey: "db_prop_multi_select_hint",
  },
  status: {
    type: "status",
    labelKey: "db_prop_status",
    Icon: CircleRoundedIcon,
    color: "#00695c",
    hintKey: "db_prop_status_hint",
  },
  date: {
    type: "date",
    labelKey: "db_prop_date",
    Icon: EventRoundedIcon,
    color: "#c62828",
    hintKey: "db_prop_date_hint",
  },
};

/** Every type, in the order shown in the type picker. */
export const PROPERTY_TYPES: readonly PropType[] = [
  "title",
  "text",
  "number",
  "select",
  "multi-select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
];

/** Types a user may create. `title` is special: there is exactly one. */
export const CREATABLE_PROPERTY_TYPES: readonly PropType[] =
  PROPERTY_TYPES.filter((type) => type !== "title");

const FALLBACK: PropertyTypeMeta = {
  type: "text",
  labelKey: "db_prop_text",
  Icon: AbcRoundedIcon,
  color: "#0288d1",
  hintKey: "db_prop_text_hint",
};

/**
 * Metadata for a property type.
 *
 * Falls back to text for an unknown type, so a document written by a newer client
 * renders as plain text rather than crashing — the same defensive posture as
 * `getDocTypePlugin` returning `undefined` for an unknown document type.
 */
export function getPropertyTypeMeta(type: PropType): PropertyTypeMeta {
  return META[type] ?? FALLBACK;
}

/** Localised label for a property type. */
export function propertyTypeLabel(type: PropType): string {
  return i18n(getPropertyTypeMeta(type).labelKey);
}

/**
 * Whether a value of this type can be compared with `>` / `<`.
 *
 * Used by filter and sort UIs to offer only meaningful operators.
 */
export function isOrderedType(type: PropType): boolean {
  return type === "number" || type === "date";
}

/** Whether this type holds character-mergeable text. */
export function isMergeableTextType(type: PropType): boolean {
  return isTextPropType(type);
}

/**
 * Whether a filter needs a value input at all.
 *
 * `is_empty` / `is_not_empty` do not, which the filter UI uses to hide the input.
 */
export function operatorNeedsValue(operator: string): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

/** Whether this property can supply board columns. */
export function canGroupByProperty(property: PropertyDef): boolean {
  return isOptionPropType(property.type);
}
