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
import {
  isChecklistPropType,
  isDependencyPropType,
  isMilestonePropType,
  isChartCategoryPropType,
  isChartMeasurePropType,
} from "./types";
import type { ChartAggregate, DateValue, PropertyDef } from "./types";
import type { DatabaseBinding } from "./model";
import { canGroupByProperty } from "./propertyTypes";
import type { ChartConfig } from "./chartData";
import { CHART_AGGREGATES } from "./types";

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

  if (property.type === "select") {
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
          sx={segmentedSx}
        >
          <ToggleButton value="and">{i18n("db_filter_and")}</ToggleButton>
          <ToggleButton value="or">{i18n("db_filter_or")}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={properties.length === 0}
          sx={popoverActionSx}
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
          sx={segmentedSx}
        >
          <ToggleButton value="asc">↑</ToggleButton>
          <ToggleButton value="desc">↓</ToggleButton>
        </ToggleButtonGroup>
        <IconButton
          size="small"
          onClick={() => onChange(sorts.filter((_, i) => i !== index))}
          aria-label={i18n("db_filter_remove")}
          sx={{ color: "text.disabled" }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
    ))}
    <Button
      size="small"
      startIcon={<AddRoundedIcon />}
      disabled={properties.length === 0 || sorts.length >= 3}
      sx={popoverActionSx}
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
  /** `table` only: how many leading columns stay put while scrolling sideways. */
  frozenColumns: number;
  layout: string;
  calendarProp: string | undefined;
  checklistProp: string | undefined;
  hideStreaks: boolean;
  gantt: {
    startProp?: string;
    endProp?: string;
    dependencyProp?: string;
    milestoneProp?: string;
  };
  /** `chart` only: the resolved shape, columns and aggregate. */
  chart: ChartConfig;
  onChangeVisible: (propId: string) => void;
  onChangeGroupBy: (propId: string | undefined) => void;
  onChangeHideEmpty: (hide: boolean) => void;
  onChangeFrozenColumns: (count: number) => void;
  onChangeCalendarProp: (propId: string | undefined) => void;
  onChangeChecklistProp: (propId: string | undefined) => void;
  onChangeHideStreaks: (hide: boolean) => void;
  onChangeChartCategory: (propId: string | undefined) => void;
  onChangeChartMeasure: (propId: string | undefined) => void;
  onChangeChartAggregate: (aggregate: ChartAggregate) => void;
  onChangeGanttColumn: (
    column: "startProp" | "endProp" | "dependencyProp" | "milestoneProp",
    propId: string | undefined,
  ) => void;
}> = ({
  properties,
  visibleProps,
  groupBy,
  hideEmptyGroups,
  frozenColumns,
  layout,
  calendarProp,
  checklistProp,
  hideStreaks,
  gantt,
  chart,
  onChangeVisible,
  onChangeGroupBy,
  onChangeHideEmpty,
  onChangeFrozenColumns,
  onChangeCalendarProp,
  onChangeChecklistProp,
  onChangeHideStreaks,
  onChangeChartCategory,
  onChangeChartMeasure,
  onChangeChartAggregate,
  onChangeGanttColumn,
}) => {
  // An empty list means "show all", so materialise it for the toggles.
  const effective = visibleProps.length
    ? visibleProps
    : properties.map((property) => property.id);

  const dateProperties = properties.filter(
    (property) => property.type === "date",
  );
  const checklistProperties = properties.filter((property) =>
    isChecklistPropType(property.type),
  );
  const dependencyProperties = properties.filter((property) =>
    isDependencyPropType(property.type),
  );
  const milestoneProperties = properties.filter((property) =>
    isMilestonePropType(property.type),
  );
  const categoryProperties = properties.filter((property) =>
    isChartCategoryPropType(property.type),
  );
  const measureProperties = properties.filter((property) =>
    isChartMeasurePropType(property.type),
  );

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

      {/* Freezing is a table setting: no other layout scrolls sideways through columns a
          record could be identified by. It is offered only while there is something to
          freeze — a one-column table has nothing it could keep in place. */}
      {layout === "table" && properties.length > 1 ? (
        <>
          <Divider sx={{ my: 1 }} />
          <FormControl size="small" fullWidth>
            <InputLabel id="db-freeze-label">
              {i18n("db_freeze_columns")}
            </InputLabel>
            <Select
              labelId="db-freeze-label"
              label={i18n("db_freeze_columns")}
              value={String(frozenColumns)}
              onChange={(event) =>
                onChangeFrozenColumns(Number(event.target.value))
              }
            >
              <MenuItem value="0">
                <em>{i18n("db_freeze_columns_none")}</em>
              </MenuItem>
              {/* One entry per possible count, labelled by the **last column it freezes**,
                  which is how a user reads the setting: "freeze up to and including Notes".
                  The value is the count that reaches that column, so the label and the
                  number agree — labelling entry `i` with the column at `i + 1` would name
                  one column too many, and the table would freeze one column fewer than the
                  picker promised.

                  At most all but one column: freezing every column leaves nothing
                  scrolling, so the setting would look as though it did nothing. The last
                  column therefore has no entry of its own. */}
              {properties.slice(0, -1).map((property, index) => (
                <MenuItem key={property.id} value={String(index + 1)}>
                  {property.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            {i18n("db_freeze_columns_hint")}
          </Typography>
        </>
      ) : null}

      {/* The journal's two settings only appear for a journal view, so the panel
          does not offer controls that would do nothing. */}
      {layout === "journal" ? (
        <>
          <Divider sx={{ my: 1 }} />

          <FormControl size="small" fullWidth>
            <InputLabel id="db-journal-date-label">
              {i18n("db_journal_calendar_prop")}
            </InputLabel>
            <Select
              labelId="db-journal-date-label"
              label={i18n("db_journal_calendar_prop")}
              value={calendarProp ?? ""}
              onChange={(event) =>
                onChangeCalendarProp(event.target.value || undefined)
              }
            >
              {/* Empty means "choose automatically", which is how a missing value
                  is read everywhere else — so this is a real choice, not a reset. */}
              <MenuItem value="">
                <em>{i18n("db_journal_checklist_none")}</em>
              </MenuItem>
              {dateProperties.map((property) => (
                <MenuItem key={property.id} value={property.id}>
                  {property.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="db-journal-checklist-label">
              {i18n("db_journal_checklist_prop")}
            </InputLabel>
            <Select
              labelId="db-journal-checklist-label"
              label={i18n("db_journal_checklist_prop")}
              value={checklistProp ?? ""}
              onChange={(event) =>
                onChangeChecklistProp(event.target.value || undefined)
              }
            >
              <MenuItem value="">
                <em>{i18n("db_journal_checklist_none")}</em>
              </MenuItem>
              {checklistProperties.map((property) => (
                <MenuItem key={property.id} value={property.id}>
                  {property.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            {i18n("db_journal_checklist_hint")}
          </Typography>

          {/* Only offered with a checklist chosen: with no checklist there are no
              streaks to show, so the switch would do nothing. */}
          {checklistProp ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {i18n("db_journal_streaks")}
              </Typography>
              <Switch
                size="small"
                checked={!hideStreaks}
                onChange={(event) => onChangeHideStreaks(!event.target.checked)}
              />
            </Box>
          ) : null}
        </>
      ) : null}

      {/* The Gantt columns only appear for a Gantt view, so the panel never offers a
          control that would do nothing. Each is a **pair of types**: a bar's ends have
          to be dates, a dependency has to be text, and a milestone has to be a
          checkbox — so the picker lists only columns the view could read. */}
      {layout === "gantt" ? (
        <>
          <Divider sx={{ my: 1 }} />

          <GanttColumnSelect
            label={i18n("db_gantt_start_prop")}
            value={gantt.startProp}
            properties={dateProperties}
            emptyLabel={i18n("db_gantt_auto")}
            onChange={(propId) => onChangeGanttColumn("startProp", propId)}
          />
          <GanttColumnSelect
            label={i18n("db_gantt_end_prop")}
            value={gantt.endProp}
            properties={dateProperties}
            emptyLabel={i18n("db_journal_checklist_none")}
            onChange={(propId) => onChangeGanttColumn("endProp", propId)}
          />
          <Typography variant="caption" color="text.secondary">
            {i18n("db_gantt_end_hint")}
          </Typography>

          <GanttColumnSelect
            label={i18n("db_gantt_dependency_prop")}
            value={gantt.dependencyProp}
            properties={dependencyProperties}
            emptyLabel={i18n("db_journal_checklist_none")}
            onChange={(propId) => onChangeGanttColumn("dependencyProp", propId)}
          />
          <Typography variant="caption" color="text.secondary">
            {i18n("db_gantt_dependency_hint")}
          </Typography>

          <GanttColumnSelect
            label={i18n("db_gantt_milestone_prop")}
            value={gantt.milestoneProp}
            properties={milestoneProperties}
            emptyLabel={i18n("db_journal_checklist_none")}
            onChange={(propId) => onChangeGanttColumn("milestoneProp", propId)}
          />
          <Typography variant="caption" color="text.secondary">
            {i18n("db_gantt_milestone_hint")}
          </Typography>
        </>
      ) : null}

      {/* The chart's controls, and only for a chart view. Shown inside the columns panel
          rather than in a bar of its own because they configure what the view draws,
          which is what this panel is for. The shape is deliberately **not** here: it is
          the one of the three a user flips constantly, and it has a toggle group in the
          chart's own toolbar, so a second picker would be two controls for one setting. */}
      {layout === "chart" ? (
        <>
          <Divider sx={{ my: 1 }} />

          <FormControl size="small" fullWidth>
            <InputLabel id="db-chart-category-label">
              {i18n("db_chart_category_prop")}
            </InputLabel>
            <Select
              labelId="db-chart-category-label"
              label={i18n("db_chart_category_prop")}
              value={chart.category?.id ?? ""}
              onChange={(event) =>
                onChangeChartCategory(event.target.value || undefined)
              }
            >
              {categoryProperties.map((property) => (
                <MenuItem key={property.id} value={property.id}>
                  {property.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="db-chart-value-label">
              {i18n("db_chart_value_prop")}
            </InputLabel>
            <Select
              labelId="db-chart-value-label"
              label={i18n("db_chart_value_prop")}
              value={chart.measure?.id ?? ""}
              onChange={(event) =>
                onChangeChartMeasure(event.target.value || undefined)
              }
            >
              {/* Empty is a real choice — count the records — not a reset, which is
                  how every other "automatic" option in this panel reads too. */}
              <MenuItem value="">
                <em>{i18n("db_chart_value_count")}</em>
              </MenuItem>
              {measureProperties.map((property) => (
                <MenuItem key={property.id} value={property.id}>
                  {property.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* With no measure there is nothing to reduce, so the aggregate picker would
              offer five ways to write the same number. */}
          {chart.measure ? (
            <>
              <FormControl size="small" fullWidth>
                <InputLabel id="db-chart-aggregate-label">
                  {i18n("db_chart_aggregate")}
                </InputLabel>
                <Select
                  labelId="db-chart-aggregate-label"
                  label={i18n("db_chart_aggregate")}
                  value={chart.aggregate}
                  onChange={(event) =>
                    onChangeChartAggregate(event.target.value as ChartAggregate)
                  }
                >
                  {CHART_AGGREGATES.map((aggregate) => (
                    <MenuItem key={aggregate} value={aggregate}>
                      {i18n(
                        `db_chart_aggregate_${aggregate}` as "db_chart_aggregate_sum",
                      )}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                {i18n("db_chart_aggregate_hint")}
              </Typography>
            </>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
};

/**
 * One Gantt column picker.
 *
 * Extracted rather than written four times: the four differ only in their label, the
 * list of columns they offer and what an empty choice means. An empty choice is always
 * a real option, not a reset — "fit/auto" for the start column, "none" for the three
 * optional ones — because a missing setting is the state each of them is designed to
 * behave sensibly in.
 */
const GanttColumnSelect: React.FC<{
  label: string;
  value: string | undefined;
  properties: PropertyDef[];
  emptyLabel: string;
  onChange: (propId: string | undefined) => void;
}> = ({ label, value, properties, emptyLabel, onChange }) => {
  // The label id has to be unique per picker, or MUI associates every one of them with
  // the same `<label>` and the fourth control announces the first one's name.
  const labelId = `db-gantt-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <FormControl size="small" fullWidth>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        label={label}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <MenuItem value="">
          <em>{emptyLabel}</em>
        </MenuItem>
        {properties.map((property) => (
          <MenuItem key={property.id} value={property.id}>
            {property.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

/**
 * Toolbar chips that open a settings section.
 *
 * A pill with a soft outline reads as a control the user can press, and the icons are
 * tinted with `text.secondary` rather than inheriting the chip's label colour — an
 * outlined chip otherwise renders a black glyph inside a grey border, which is the
 * heaviest thing in an otherwise quiet toolbar.
 */
const settingsChipSx = (hasLabel: boolean) =>
  ({
    height: 26,
    borderRadius: "13px",
    cursor: "pointer",
    "& .MuiChip-icon": { fontSize: 16, color: "text.secondary" },
    "&.MuiChip-colorPrimary": { color: "#fff" },
    // With no text the chip must collapse to a 26×26 circle around the icon.
    //
    // MUI always renders the label element, and reserves 14px of label padding for it
    // even when it is empty. Its icon element also carries `margin: 2px -4px` — an
    // allowance meant for a chip that *has* text, where the label's own padding supplies
    // the gap. With no text nothing does, and the two errors compound into a 29×26
    // ellipse with the glyph 3px from the left edge and 11px from the right.
    //
    // Zeroing both leaves the icon centred by the chip's own `justify-content: center`.
    // A chip that *does* carry a count keeps MUI's spacing untouched.
    ...(hasLabel
      ? {}
      : {
          // Pinned to the chip's own height so the two radii are equal: MUI sizes an
          // icon-only chip from its content (16px icon + 1px), which leaves a 17×26
          // vertical ellipse. The chip centres its content, so the glyph lands dead
          // centre without further adjustment.
          width: 26,
          "& .MuiChip-icon": {
            fontSize: 16,
            color: "text.secondary",
            margin: 0,
          },
          "& .MuiChip-label": { display: "none" },
        }),
  }) as const;

/**
 * A section's primary action inside a settings popover.
 *
 * Left-aligned rather than floating in the middle of the panel: these popovers are
 * forms, and a centred button reads as a dialog's confirm step.
 */
const popoverActionSx = {
  textTransform: "none",
  mt: 0.5,
  justifyContent: "flex-start",
  px: 0.5,
} as const;

/** Segmented control (AND/OR, ascending/descending) inside a settings popover. */
const segmentedSx = {
  "& .MuiToggleButton-root": {
    textTransform: "none",
    px: 1.25,
    fontSize: "0.8125rem",
    fontWeight: 500,
  },
} as const;

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
  /**
   * How many leading columns this view freezes.
   *
   * Read through the model rather than from `view.frozenColumns`, so the panel shows the
   * **clamped** value the table actually honours — a stored count beyond the visible
   * columns (someone hid a column after freezing) would otherwise display a number the
   * table does not use.
   */
  const frozenColumns = useMemo(
    () =>
      binding.getViewFrozenColumns(
        viewId,
        binding.getViewProperties(viewId).length,
      ),
    [binding, viewId, revision],
  );
  /**
   * The chart the view draws, resolved rather than read raw.
   *
   * The panel has to show the columns the chart is **actually** using, including the
   * ones chosen by fallback — showing an empty category picker while a chart is drawn
   * from an automatically chosen column would read as a bug.
   */
  const chart = useMemo(
    () => binding.getViewChartConfig(viewId),
    [binding, viewId, revision],
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
            sx={settingsChipSx(filterCount > 0)}
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
            sx={settingsChipSx(sortCount > 0)}
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
            sx={settingsChipSx(false)}
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
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
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
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
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
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {i18n("db_visible_properties")}
        </Typography>
        <ColumnsEditor
          properties={properties}
          visibleProps={view.visibleProps}
          groupBy={view.groupBy}
          hideEmptyGroups={view.hideEmptyGroups ?? false}
          frozenColumns={frozenColumns}
          layout={view.layout}
          calendarProp={view.calendarProp}
          checklistProp={view.checklistProp}
          hideStreaks={view.hideStreaks ?? false}
          gantt={{
            startProp: view.startProp,
            endProp: view.endProp,
            dependencyProp: view.dependencyProp,
            milestoneProp: view.milestoneProp,
          }}
          chart={chart}
          onChangeVisible={(propId) =>
            binding.toggleViewProperty(viewId, propId)
          }
          onChangeGroupBy={(propId) => binding.setViewGroupBy(viewId, propId)}
          onChangeHideEmpty={(hide) =>
            binding.setViewHideEmptyGroups(viewId, hide)
          }
          onChangeFrozenColumns={(count) =>
            binding.setViewFrozenColumns(viewId, count)
          }
          onChangeCalendarProp={(propId) =>
            binding.setViewCalendarProp(viewId, propId)
          }
          onChangeChecklistProp={(propId) =>
            binding.setViewChecklistProp(viewId, propId)
          }
          onChangeHideStreaks={(hide) =>
            binding.setViewHideStreaks(viewId, hide)
          }
          onChangeChartCategory={(propId) =>
            binding.setViewChartCategory(viewId, propId)
          }
          onChangeChartMeasure={(propId) =>
            binding.setViewChartMeasure(viewId, propId)
          }
          onChangeChartAggregate={(aggregate) =>
            binding.setViewChartAggregate(viewId, aggregate)
          }
          onChangeGanttColumn={(column, propId) =>
            binding.setViewGanttColumn(viewId, column, propId)
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
          sx={{ textTransform: "none", color: "text.secondary" }}
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
