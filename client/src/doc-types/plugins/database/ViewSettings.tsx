import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import ViewColumnRoundedIcon from "@mui/icons-material/ViewColumnRounded";
import { datePickerDialog } from "../../../components/common/DatePickerDialogService";
import { i18n } from "../../../internationnalization/utils";
import {
  MAX_FILTER_DEPTH,
  OPERATORS_BY_TYPE,
  defaultOperatorFor,
  operatorNeedsValue,
  type FilterCondition,
  type FilterNode,
  type FilterOperator,
  type SortRule,
} from "./filterSort";
import { getPropertyTypeMeta } from "./propertyTypes";
import type { DatabaseBinding } from "./model";
import { canGroupByProperty } from "./propertyTypes";
import type { DateValue, PropertyDef } from "./types";

/**
 * View settings: filter, sort, group and column visibility.
 *
 * All of these live on the **view**, so the same rows can be sliced differently
 * without duplicating data. They are shared state (they sync to collaborators),
 * matching Notion's "save for everyone" behaviour; a personal-only bucket would be
 * a separate concern.
 */

/** Human-readable operator names, so the UI never shows a raw token. */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  does_not_contain: "does not contain",
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  eq: "equals",
  neq: "does not equal",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  is_before: "is before",
  is_after: "is after",
  is_on_or_before: "is on or before",
  is_on_or_after: "is on or after",
};

const operatorLabel = (operator: FilterOperator) => OPERATOR_LABELS[operator];

/** Look up a property by id, tolerating a dangling reference. */
const findProperty = (properties: PropertyDef[], propId: string) =>
  properties.find((property) => property.id === propId);

/**
 * The value editor for a filter condition.
 *
 * Reuses the same choices the cell editors offer (options, dates, booleans) so a
 * filter cannot be given a value the column could never hold.
 */
const ConditionValueInput: React.FC<{
  property: PropertyDef;
  operator: FilterOperator;
  value: unknown;
  onChange: (value: unknown) => void;
}> = ({ property, operator, value, onChange }) => {
  if (!operatorNeedsValue(operator)) return null;

  const text =
    typeof value === "string"
      ? value
      : value === undefined
        ? ""
        : String(value);

  if (property.type === "select" || property.type === "status") {
    return (
      <Select
        size="small"
        displayEmpty
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="">
          <em>{i18n("db_filter_any")}</em>
        </MenuItem>
        {property.options.map((option) => (
          <MenuItem key={option.id} value={option.name}>
            {option.name}
          </MenuItem>
        ))}
      </Select>
    );
  }

  if (property.type === "checkbox") {
    return (
      <Select
        size="small"
        value={value === true ? "true" : value === false ? "false" : "true"}
        onChange={(event) => onChange(event.target.value === "true")}
        sx={{ minWidth: 100 }}
      >
        <MenuItem value="true">{i18n("db_filter_checked")}</MenuItem>
        <MenuItem value="false">{i18n("db_filter_unchecked")}</MenuItem>
      </Select>
    );
  }

  if (property.type === "date") {
    const current =
      value && typeof value === "object" && "start" in (value as DateValue)
        ? (value as DateValue).start
        : "";
    return (
      <Button
        size="small"
        variant="outlined"
        onClick={async () => {
          const result = await datePickerDialog.open({
            title: i18n("db_cell_pick_date"),
            buttonText: i18n("confirm_button"),
            initDate: current ? Date.parse(current) : undefined,
          });
          if (result.type === "confirm") {
            onChange({ start: new Date(result.timestamp).toISOString() });
          }
        }}
      >
        {current ? current.slice(0, 10) : i18n("db_cell_pick_date")}
      </Button>
    );
  }

  if (property.type === "number") {
    return (
      <TextField
        size="small"
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          const parsed = Number(raw);
          // Keep an unparseable entry as text so the field stays editable; the
          // evaluator ignores a non-numeric condition rather than matching all.
          onChange(raw.trim() !== "" && Number.isFinite(parsed) ? parsed : raw);
        }}
        sx={{ width: 100 }}
      />
    );
  }

  return (
    <TextField
      size="small"
      value={text}
      onChange={(event) => onChange(event.target.value)}
      placeholder={i18n("db_filter_value")}
      sx={{ minWidth: 140 }}
    />
  );
};

/** One condition row: property, operator, value, remove. */
const ConditionRow: React.FC<{
  condition: FilterCondition;
  properties: PropertyDef[];
  onChange: (next: FilterCondition | null) => void;
  onRemove: () => void;
}> = ({ condition, properties, onChange, onRemove }) => {
  const property = findProperty(properties, condition.propId);
  const operators = property
    ? OPERATORS_BY_TYPE[property.type]
    : (["is"] as readonly FilterOperator[]);

  return (
    <Box
      sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
    >
      <Select
        size="small"
        value={condition.propId}
        onChange={(event) =>
          onChange({
            ...condition,
            propId: event.target.value,
            // The old operator may not exist for the new type.
            operator: defaultOperatorFor(
              findProperty(properties, event.target.value)?.type ?? "text",
            ),
            value: undefined,
          })
        }
        sx={{ minWidth: 130 }}
      >
        {properties.map((candidate) => (
          <MenuItem key={candidate.id} value={candidate.id}>
            {candidate.name}
          </MenuItem>
        ))}
      </Select>

      <Select
        size="small"
        value={condition.operator}
        onChange={(event) =>
          onChange({
            ...condition,
            operator: event.target.value as FilterOperator,
          })
        }
        sx={{ minWidth: 150 }}
      >
        {operators.map((operator) => (
          <MenuItem key={operator} value={operator}>
            {operatorLabel(operator)}
          </MenuItem>
        ))}
      </Select>

      {property ? (
        <ConditionValueInput
          property={property}
          operator={condition.operator}
          value={condition.value}
          onChange={(value) => onChange({ ...condition, value })}
        />
      ) : null}

      <IconButton
        size="small"
        onClick={onRemove}
        aria-label={i18n("db_filter_remove")}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

/** Filter editor: a list of conditions, with an AND/OR choice. */
const FilterEditor: React.FC<{
  filter: FilterNode | undefined;
  properties: PropertyDef[];
  onChange: (filter: FilterNode | undefined) => void;
}> = ({ filter, properties, onChange }) => {
  // Only a single level of groups is exposed. The model and evaluator support
  // nesting to `MAX_FILTER_DEPTH`, but a nested editor is a lot of UI for a case
  // users rarely reach for; the flat form covers the common need.
  const root = useMemo(() => {
    if (!filter)
      return { op: "and" as const, conditions: [] as FilterCondition[] };
    if (filter.kind === "condition") {
      return { op: "and" as const, conditions: [filter] };
    }
    const conditions = filter.children.filter(
      (child): child is FilterCondition => child.kind === "condition",
    );
    return { op: filter.op, conditions };
  }, [filter]);

  const commit = (op: "and" | "or", conditions: FilterCondition[]) => {
    if (conditions.length === 0) {
      onChange(undefined);
      return;
    }
    onChange({ kind: "group", op, children: conditions });
  };

  const updateCondition = (index: number, next: FilterCondition | null) => {
    const conditions = [...root.conditions];
    if (next === null) conditions.splice(index, 1);
    else conditions[index] = next;
    commit(root.op, conditions);
  };

  return (
    <Stack spacing={1}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={root.op}
          onChange={(_event, value: "and" | "or" | null) => {
            if (value) commit(value, root.conditions);
          }}
        >
          <ToggleButton value="and">{i18n("db_filter_and")}</ToggleButton>
          <ToggleButton value="or">{i18n("db_filter_or")}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={properties.length === 0}
          onClick={() => {
            const first = properties[0];
            commit(root.op, [
              ...root.conditions,
              {
                kind: "condition",
                propId: first.id,
                operator: defaultOperatorFor(first.type),
              },
            ]);
          }}
        >
          {i18n("db_add_filter")}
        </Button>
      </Box>

      {root.conditions.map((condition, index) => (
        <ConditionRow
          key={`${condition.propId}-${index}`}
          condition={condition}
          properties={properties}
          onChange={(next) => updateCondition(index, next)}
          onRemove={() => updateCondition(index, null)}
        />
      ))}

      {root.conditions.length === 0 ? (
        <Typography variant="body2" color="text.disabled">
          {i18n("db_filter_none")}
        </Typography>
      ) : null}

      {filter && root.conditions.length === 0 && filter.kind === "group" ? (
        <Typography variant="caption" color="text.secondary">
          {i18n("db_filter_nested_hidden")}
        </Typography>
      ) : null}
    </Stack>
  );
};

/** Sort editor: an ordered list of rules. */
const SortEditor: React.FC<{
  sorts: SortRule[];
  properties: PropertyDef[];
  onChange: (sorts: SortRule[]) => void;
}> = ({ sorts, properties, onChange }) => (
  <Stack spacing={1}>
    {sorts.map((rule, index) => (
      <Box key={`${rule.propId}-${index}`} sx={{ display: "flex", gap: 1 }}>
        <Select
          size="small"
          value={rule.propId}
          onChange={(event) => {
            const next = [...sorts];
            next[index] = { ...rule, propId: event.target.value };
            onChange(next);
          }}
          sx={{ minWidth: 130 }}
        >
          {properties.map((property) => (
            <MenuItem key={property.id} value={property.id}>
              {property.name}
            </MenuItem>
          ))}
        </Select>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={rule.direction}
          onChange={(_event, value: "asc" | "desc" | null) => {
            if (!value) return;
            const next = [...sorts];
            next[index] = { ...rule, direction: value };
            onChange(next);
          }}
        >
          <ToggleButton value="asc">↑</ToggleButton>
          <ToggleButton value="desc">↓</ToggleButton>
        </ToggleButtonGroup>
        <IconButton
          size="small"
          onClick={() => onChange(sorts.filter((_, i) => i !== index))}
          aria-label={i18n("db_filter_remove")}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
    ))}
    <Button
      size="small"
      startIcon={<AddRoundedIcon />}
      disabled={properties.length === 0 || sorts.length >= 3}
      onClick={() =>
        onChange([...sorts, { propId: properties[0].id, direction: "asc" }])
      }
    >
      {i18n("db_add_sort")}
    </Button>
  </Stack>
);

/** Column visibility and grouping. */
const ColumnsEditor: React.FC<{
  properties: PropertyDef[];
  visibleProps: string[];
  groupBy: string | undefined;
  hideEmptyGroups: boolean;
  onChangeVisible: (propId: string) => void;
  onChangeGroupBy: (propId: string | undefined) => void;
  onChangeHideEmpty: (hide: boolean) => void;
}> = ({
  properties,
  visibleProps,
  groupBy,
  hideEmptyGroups,
  onChangeVisible,
  onChangeGroupBy,
  onChangeHideEmpty,
}) => {
  // An empty list means "show all", so materialise it for the toggles.
  const effective = visibleProps.length
    ? visibleProps
    : properties.map((property) => property.id);

  return (
    <Stack spacing={1}>
      {properties.map((property) => {
        const meta = getPropertyTypeMeta(property.type);
        return (
          <Box
            key={property.id}
            sx={{ display: "flex", alignItems: "center", gap: 1 }}
          >
            <meta.Icon sx={{ fontSize: 16, color: meta.color }} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {property.name}
            </Typography>
            <Switch
              size="small"
              checked={effective.includes(property.id)}
              // A `title` column cannot be hidden: a record with no visible name is
              // unusable, and the record panel keys off it.
              disabled={property.type === "title"}
              onChange={() => onChangeVisible(property.id)}
            />
          </Box>
        );
      })}

      <Divider sx={{ my: 1 }} />

      <FormControl size="small" fullWidth>
        <InputLabel id="db-group-by-label">{i18n("db_group_by")}</InputLabel>
        <Select
          labelId="db-group-by-label"
          label={i18n("db_group_by")}
          value={groupBy ?? ""}
          onChange={(event) => onChangeGroupBy(event.target.value || undefined)}
        >
          <MenuItem value="">
            <em>{i18n("db_group_by_none")}</em>
          </MenuItem>
          {properties.filter(canGroupByProperty).map((property) => (
            <MenuItem key={property.id} value={property.id}>
              {property.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {groupBy ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {i18n("db_hide_empty_groups")}
          </Typography>
          <Switch
            size="small"
            checked={hideEmptyGroups}
            onChange={(event) => onChangeHideEmpty(event.target.checked)}
          />
        </Box>
      ) : null}
    </Stack>
  );
};

/**
 * The settings popover for the active view.
 *
 * Rendered as a menu plus a dialog: the trigger is a chip in the view toolbar that
 * summarises the state (`2 filters`, `sorted`), so the user can see at a glance why
 * a view is showing what it shows — a filtered view with no visible indication is a
 * common source of "where did my rows go".
 */
export const ViewSettingsButton: React.FC<{
  binding: DatabaseBinding;
  viewId: string;
  revision: number;
}> = ({ binding, viewId, revision }) => {
  // The section is tracked *with* the element that opened it, so an open panel
  // always has a valid anchor: rendering an `open` panel without an `anchorEl` is
  // an MUI error. These panels are forms rather than lists of commands, so they are
  // Popovers anchored to the chip that was clicked, not Menus.
  const [open, setOpen] = useState<{
    section: "filter" | "sort" | "columns";
    anchor: HTMLElement;
  } | null>(null);
  const close = () => setOpen(null);

  const view = useMemo(
    () => binding.getViews().find((candidate) => candidate.id === viewId),
    [binding, viewId, revision],
  );
  const properties = useMemo(
    () => binding.getProperties(),
    [binding, revision],
  );

  if (!view) return null;

  const sortCount = view.sorts?.length ?? 0;
  const filterCount = countConditions(view.filter);

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Tooltip title={i18n("db_filter")}>
          <Chip
            size="small"
            variant={filterCount ? "filled" : "outlined"}
            color={filterCount ? "primary" : "default"}
            icon={<FilterAltRoundedIcon />}
            label={filterCount ? String(filterCount) : undefined}
            onClick={(event) =>
              setOpen({ section: "filter", anchor: event.currentTarget })
            }
            sx={{ cursor: "pointer" }}
          />
        </Tooltip>
        <Tooltip title={i18n("db_sort")}>
          <Chip
            size="small"
            variant={sortCount ? "filled" : "outlined"}
            color={sortCount ? "primary" : "default"}
            icon={<SortRoundedIcon />}
            label={sortCount ? String(sortCount) : undefined}
            onClick={(event) =>
              setOpen({ section: "sort", anchor: event.currentTarget })
            }
            sx={{ cursor: "pointer" }}
          />
        </Tooltip>
        <Tooltip title={i18n("db_visible_properties")}>
          <Chip
            size="small"
            variant="outlined"
            icon={<ViewColumnRoundedIcon />}
            onClick={(event) =>
              setOpen({ section: "columns", anchor: event.currentTarget })
            }
            sx={{ cursor: "pointer" }}
          />
        </Tooltip>
      </Box>

      <Popover
        open={open?.section === "filter"}
        anchorEl={open?.anchor ?? null}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 480, maxWidth: "90vw" } } }}
      >
        <Typography variant="subtitle2" gutterBottom>
          {i18n("db_filter")}
        </Typography>
        <FilterEditor
          filter={view.filter}
          properties={properties}
          onChange={(filter) => binding.setViewFilter(viewId, filter)}
        />
      </Popover>

      <Popover
        open={open?.section === "sort"}
        anchorEl={open?.anchor ?? null}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 360 } } }}
      >
        <Typography variant="subtitle2" gutterBottom>
          {i18n("db_sort")}
        </Typography>
        <SortEditor
          sorts={view.sorts ?? []}
          properties={properties}
          onChange={(sorts) => binding.setViewSorts(viewId, sorts)}
        />
      </Popover>

      <Popover
        open={open?.section === "columns"}
        anchorEl={open?.anchor ?? null}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 320 } } }}
      >
        <Typography variant="subtitle2" gutterBottom>
          {i18n("db_visible_properties")}
        </Typography>
        <ColumnsEditor
          properties={properties}
          visibleProps={view.visibleProps}
          groupBy={view.groupBy}
          hideEmptyGroups={view.hideEmptyGroups ?? false}
          onChangeVisible={(propId) =>
            binding.toggleViewProperty(viewId, propId)
          }
          onChangeGroupBy={(propId) => binding.setViewGroupBy(viewId, propId)}
          onChangeHideEmpty={(hide) =>
            binding.setViewHideEmptyGroups(viewId, hide)
          }
        />
      </Popover>

      {filterCount || sortCount ? (
        <Button
          size="small"
          onClick={() => {
            binding.setViewFilter(viewId, undefined);
            binding.setViewSorts(viewId, []);
          }}
        >
          {i18n("db_clear_view_settings")}
        </Button>
      ) : null}
    </>
  );
};

/** Number of conditions in a filter tree, for the toolbar badge. */
function countConditions(filter: FilterNode | undefined): number {
  if (!filter) return 0;
  if (filter.kind === "condition") return 1;
  return filter.children.reduce(
    (total, child) => total + countConditions(child),
    0,
  );
}

/** Re-exported so callers do not need to know where the depth cap lives. */
export { MAX_FILTER_DEPTH };
