import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { useLocale } from "../../../hooks/hooks";
import { buildChartData, type ChartPoint } from "./chartData";
import {
  bands,
  niceScale,
  pieArcPath,
  pieSlices,
  scaleY,
} from "./chartGeometry";
import { COLOR_COLUMNS, COLOR_TIERS, optionColorHex } from "./optionColors";
import type { DatabaseBinding } from "./model";
import { CHART_TYPES, type ChartType } from "./types";

/**
 * The chart view: categories on one axis, an aggregated measure on the other.
 *
 * Hand-drawn SVG rather than a charting library. The app has no chart dependency, and
 * the three shapes it draws are a few hundred lines of arithmetic that
 * `chartGeometry.ts` and `chartData.ts` already own and test — pulling in a rendering
 * engine for them would be a second, larger implementation of the same thing.
 *
 * The component is a **renderer over the resolved config**: the columns, the aggregate
 * and the shape come from `getViewChartConfig`, and every number comes from
 * `buildChartData`. Nothing here decides what a chart means, which is what keeps the
 * drawn chart, the settings panel and the tooltips from disagreeing.
 */

/** The drawing area: margins make room for the value axis and the category labels. */
const MARGIN = { top: 16, right: 16, bottom: 48, left: 60 } as const;
const CHART_HEIGHT = 300;
/** Below this the axis cannot be drawn one label wide, so the SVG keeps this width. */
const MIN_PLOT_WIDTH = 200;

const AXIS_COLOR = "#bdbdbd";
const GRID_COLOR = "rgba(0, 0, 0, 0.08)";
const LABEL_COLOR = "#616161";
/**
 * A line's stroke.
 *
 * Deliberately neutral rather than the first series colour: the stroke joins every
 * category, so giving it one category's colour would read as "this line is that
 * category". The dots carry the category colours.
 */
const LINE_COLOR = "#607d8b";
const BAR_RADIUS = 3;

/**
 * Colours for categories that carry none of their own.
 *
 * The vivid tier of the option palette: a chart's fills are large areas rather than
 * small chips, so the macaron tier is too pale to separate neighbouring bars and the
 * deep tier turns a chart of ten categories into one dark mass.
 */
const SERIES_PALETTE = (
  COLOR_COLUMNS[COLOR_TIERS.indexOf("vivid")] ?? COLOR_COLUMNS[0]
).map((swatch) => swatch.hex);

const seriesColor = (index: number): string =>
  SERIES_PALETTE[index % SERIES_PALETTE.length];

const colorOf = (point: ChartPoint, index: number): string =>
  point.color ? optionColorHex(point.color) : seriesColor(index);

/** Long labels crowd an axis: shorten with an ellipsis rather than overlapping ticks. */
const truncate = (label: string, max = 16): string =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

export const ChartView: React.FC<{
  binding: DatabaseBinding;
  viewId: string;
  readOnly?: boolean;
  revision: number;
}> = ({ binding, viewId, readOnly, revision }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const locale = useLocale();

  /** The plot has to fit the column it is in, so its width is measured, not assumed. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const config = useMemo(
    () => binding.getViewChartConfig(viewId),
    [binding, viewId, revision],
  );
  const rows = useMemo(
    () => binding.getViewRows(viewId),
    [binding, viewId, revision],
  );

  const plan = useMemo(
    () =>
      buildChartData({
        rows,
        category: config.category,
        measure: config.measure,
        aggregate: config.aggregate,
        language: locale,
        labels: {
          noValue: i18n("db_chart_no_value"),
          other: i18n("db_chart_other"),
          checked: i18n("db_filter_checked"),
          unchecked: i18n("db_filter_unchecked"),
        },
      }),
    [rows, config, locale],
  );

  const format = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const percentFormat = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const formatValue = (value: number) => format.format(value);
  const formatPercent = (fraction: number) => percentFormat.format(fraction);

  const plotWidth = Math.max(
    MIN_PLOT_WIDTH,
    (width || MIN_PLOT_WIDTH) - MARGIN.left - MARGIN.right,
  );
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const scale = useMemo(
    () => niceScale(plan.points.map((point) => point.value)),
    [plan.points],
  );
  /** Value → y, with the plot's top margin already applied. */
  const y = (value: number) =>
    MARGIN.top + scaleY(value, scale.min, scale.max, plotHeight);

  /**
   * The recovery state: no column to group by.
   *
   * Unlike the journal and the Gantt, switching the layout does **not** create a column
   * here. Their date column is a write target — day keys and bar ends are stored in it —
   * whereas a chart only reads, so a missing category is a picker, not a missing schema.
   */
  if (!config.category) {
    return (
      <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
        <Typography variant="body2">
          {i18n("db_chart_needs_category")}
        </Typography>
        <Typography variant="caption">
          {i18n("db_chart_needs_category_hint")}
        </Typography>
      </Box>
    );
  }

  if (plan.points.length === 0) {
    return (
      <Box ref={containerRef} sx={{ width: "100%" }}>
        {/* The shape toggle stays visible here, because an empty pie is exactly the
            state a user may want to leave for a bar chart of the same zeros. */}
        <ChartToolbar
          type={config.type}
          readOnly={readOnly}
          onChange={(type) => binding.setViewChartType(viewId, type)}
        />
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <Typography variant="body2">
            {rows.length === 0
              ? i18n("db_no_rows")
              : i18n("db_chart_no_values")}
          </Typography>
          <Typography variant="caption">
            {rows.length === 0
              ? i18n("db_no_rows_hint")
              : i18n("db_chart_no_values_hint")}
          </Typography>
        </Box>
        {plan.skipped > 0 ? <SkippedNote count={plan.skipped} /> : null}
      </Box>
    );
  }

  const positiveCount = plan.points.filter((point) => point.value > 0).length;
  const pieDrawable = positiveCount > 0;
  /**
   * The base a pie's shares are taken of: the positive total, matching `pieSlices`.
   *
   * Not `plan.total`, which includes negative values — a legend percentage that divided
   * by a different number from the slice it labels would be visibly wrong.
   */
  const pieTotal = plan.points.reduce(
    (sum, point) => sum + Math.max(0, point.value),
    0,
  );

  return (
    <Box ref={containerRef} sx={{ width: "100%" }}>
      <ChartToolbar
        type={config.type}
        readOnly={readOnly}
        onChange={(type) => binding.setViewChartType(viewId, type)}
      />

      {config.type === "pie" ? (
        <PieChart
          points={plan.points}
          plotWidth={plotWidth}
          plotHeight={plotHeight}
          formatValue={formatValue}
          formatPercent={formatPercent}
        />
      ) : (
        <svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 ${MARGIN.left + plotWidth + MARGIN.right} ${CHART_HEIGHT}`}
          role="img"
        >
          <Axis
            scale={scale}
            y={y}
            plotWidth={plotWidth}
            formatValue={formatValue}
          />
          {config.type === "bar" ? (
            <Bars
              points={plan.points}
              slots={bands(plan.points.length, plotWidth)}
              y={y}
              zeroY={y(0)}
              colorOf={colorOf}
              formatValue={formatValue}
            />
          ) : (
            <Line
              points={plan.points}
              slots={bands(plan.points.length, plotWidth)}
              y={y}
              formatValue={formatValue}
            />
          )}
          <CategoryLabels
            points={plan.points}
            slots={bands(plan.points.length, plotWidth)}
            baseline={MARGIN.top + plotHeight}
          />
        </svg>
      )}

      <Legend
        points={plan.points}
        colorOf={colorOf}
        type={config.type}
        shareBase={pieTotal}
        formatValue={formatValue}
        formatPercent={formatPercent}
      />

      {config.type === "pie" && !pieDrawable ? (
        <Typography variant="caption" display="block" color="warning.main">
          {i18n("db_chart_pie_positive_only")}
        </Typography>
      ) : null}
      {config.type === "pie" &&
      pieDrawable &&
      positiveCount < plan.points.length ? (
        <Typography variant="caption" display="block" color="text.secondary">
          {i18n("db_chart_pie_omitted")}
        </Typography>
      ) : null}
      {plan.folded ? (
        <Typography variant="caption" display="block" color="text.secondary">
          {i18n("db_chart_other_hint")}
        </Typography>
      ) : null}
      {plan.skipped > 0 ? <SkippedNote count={plan.skipped} /> : null}
    </Box>
  );
};

/**
 * The shape control.
 *
 * Rendered whenever there is a chart to shape, empty states included: a pie whose values
 * are all zero is exactly the state a user wants to leave for a bar chart of the same
 * zeros, and without the control here the columns panel would be the only way back.
 *
 * The shape is a **view setting** rather than a local pick, so two people reading "this
 * view" see the same chart — unlike the Gantt's zoom, a shape is not a viewport fact.
 */
const ChartToolbar: React.FC<{
  type: ChartType;
  readOnly?: boolean;
  onChange: (type: ChartType) => void;
}> = ({ type, readOnly, onChange }) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 0.5,
      flexWrap: "wrap",
      mb: 0.5,
    }}
  >
    <Box sx={{ flex: 1 }} />
    {!readOnly ? (
      <ToggleButtonGroup
        size="small"
        exclusive
        value={type}
        onChange={(_event, value: ChartType | null) => {
          if (value) onChange(value);
        }}
      >
        {CHART_TYPES.map((candidate) => (
          <ToggleButton
            key={candidate}
            value={candidate}
            sx={{ textTransform: "none", px: 1.25 }}
          >
            {i18n(`db_chart_${candidate}` as "db_chart_bar")}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    ) : null}
  </Box>
);

/** The value axis: gridlines, labels and the zero line. */
const Axis: React.FC<{
  scale: { min: number; max: number; ticks: number[] };
  y: (value: number) => number;
  plotWidth: number;
  formatValue: (value: number) => string;
}> = ({ scale, y, plotWidth, formatValue }) => (
  <>
    {scale.ticks.map((tick) => (
      <g key={tick}>
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + plotWidth}
          y1={y(tick)}
          y2={y(tick)}
          stroke={tick === 0 ? AXIS_COLOR : GRID_COLOR}
        />
        <text
          x={MARGIN.left - 8}
          y={y(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={11}
          fill={LABEL_COLOR}
        >
          {formatValue(tick)}
        </text>
      </g>
    ))}
  </>
);

/** Vertical bars from the zero line to each category's value. */
const Bars: React.FC<{
  points: readonly ChartPoint[];
  slots: { x: number; width: number; center: number }[];
  y: (value: number) => number;
  zeroY: number;
  colorOf: (point: ChartPoint, index: number) => string;
  formatValue: (value: number) => string;
}> = ({ points, slots, y, zeroY, colorOf, formatValue }) => {
  // Dense groups have no room for a label on every bar, and the hover title carries the
  // value anyway; sparse ones do, and there the precise number is what a reader wants.
  const labelled = points.length <= 14;
  return (
    <>
      {points.map((point, index) => {
        const slot = slots[index];
        if (!slot) return null;
        const valueY = y(point.value);
        const top = Math.min(valueY, zeroY);
        const height = Math.max(1, Math.abs(valueY - zeroY));
        const fill = colorOf(point, index);
        return (
          <g key={point.key}>
            <rect
              x={MARGIN.left + slot.x}
              y={top}
              width={slot.width}
              height={height}
              rx={BAR_RADIUS}
              fill={fill}
              fillOpacity={point.other ? 0.6 : 1}
            >
              <title>{`${point.label}: ${formatValue(point.value)}`}</title>
            </rect>
            {labelled && slot.width >= 24 ? (
              <text
                x={MARGIN.left + slot.center}
                y={point.value < 0 ? top + height + 12 : top - 4}
                textAnchor="middle"
                fontSize={10}
                fill={LABEL_COLOR}
              >
                {formatValue(point.value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
};

/** A polyline through the category centres, with a dot per point. */
const Line: React.FC<{
  points: readonly ChartPoint[];
  slots: { x: number; width: number; center: number }[];
  y: (value: number) => number;
  formatValue: (value: number) => string;
}> = ({ points, slots, y, formatValue }) => {
  const coordinates = points
    .map((point, index) => {
      const slot = slots[index];
      return slot ? `${MARGIN.left + slot.center},${y(point.value)}` : "";
    })
    .filter(Boolean);

  return (
    <>
      {/* A one-point line is a dot: a `polyline` with a single coordinate draws
          nothing, so the marker below is what makes that state visible. */}
      {coordinates.length > 1 ? (
        <polyline
          points={coordinates.join(" ")}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ) : null}
      {points.map((point, index) => {
        const slot = slots[index];
        if (!slot) return null;
        return (
          <circle
            key={point.key}
            cx={MARGIN.left + slot.center}
            cy={y(point.value)}
            r={3.5}
            fill={colorOf(point, index)}
          >
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        );
      })}
    </>
  );
};

/** Category labels under the axis. */
const CategoryLabels: React.FC<{
  points: readonly ChartPoint[];
  slots: { x: number; width: number; center: number }[];
  baseline: number;
}> = ({ points, slots, baseline }) => {
  const estimate = (label: string) => truncate(label).length * 6.4;
  return (
    <>
      {points.map((point, index) => {
        const slot = slots[index];
        if (!slot) return null;
        const label = truncate(point.label);
        // Rotated when the labels would run into each other, which is the only way to
        // keep twelve month names on one axis legible rather than every other one.
        const rotate = estimate(point.label) > slot.width + 4;
        return (
          <text
            key={point.key}
            x={MARGIN.left + slot.center}
            y={baseline + 14}
            textAnchor={rotate ? "end" : "middle"}
            dominantBaseline={rotate ? "middle" : "hanging"}
            fontSize={11}
            fill={LABEL_COLOR}
            transform={
              rotate
                ? `rotate(-35 ${MARGIN.left + slot.center} ${baseline + 14})`
                : undefined
            }
          >
            {label}
          </text>
        );
      })}
    </>
  );
};

/** The pie, drawn to the left of the legend. */
const PieChart: React.FC<{
  points: readonly ChartPoint[];
  plotWidth: number;
  plotHeight: number;
  formatValue: (value: number) => string;
  formatPercent: (fraction: number) => string;
}> = ({ points, plotWidth, plotHeight, formatValue, formatPercent }) => {
  const slices = pieSlices(points.map((point) => point.value));
  const radius = Math.max(20, Math.min(plotWidth, plotHeight) / 2 - 8);
  const cx = MARGIN.left + plotWidth / 2;
  const cy = MARGIN.top + plotHeight / 2;

  return (
    <svg
      width="100%"
      height={CHART_HEIGHT}
      viewBox={`0 0 ${MARGIN.left + plotWidth + MARGIN.right} ${CHART_HEIGHT}`}
      role="img"
    >
      {points.map((point, index) => {
        const slice = slices[index];
        if (!slice || slice.fraction <= 0) return null;
        return (
          <path
            key={point.key}
            d={pieArcPath(cx, cy, radius, slice.startAngle, slice.endAngle)}
            fill={colorOf(point, index)}
            stroke="#fff"
            strokeWidth={1}
          >
            <title>
              {`${point.label}: ${formatValue(point.value)} (${formatPercent(slice.fraction)})`}
            </title>
          </path>
        );
      })}
    </svg>
  );
};

/** Category colours, names and values, under the chart. */
const Legend: React.FC<{
  points: readonly ChartPoint[];
  colorOf: (point: ChartPoint, index: number) => string;
  type: ChartType;
  /** Total the pie's shares are taken of; ignored by the other two shapes. */
  shareBase: number;
  formatValue: (value: number) => string;
  formatPercent: (fraction: number) => string;
}> = ({ points, colorOf, type, shareBase, formatValue, formatPercent }) => (
  <Box
    sx={{
      display: "flex",
      flexWrap: "wrap",
      gap: 1.5,
      mt: 1,
      justifyContent: "center",
    }}
  >
    {points.map((point, index) => (
      <Box
        key={point.key}
        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
      >
        <Box
          component="span"
          sx={{
            width: 10,
            height: 10,
            borderRadius: "3px",
            backgroundColor: colorOf(point, index),
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {truncate(point.label, 24)}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {formatValue(point.value)}
          {/* A share of the total is only a share when the values are all the parts of
              it, which is what a pie draws and neither of the other two shapes does. */}
          {type === "pie" && shareBase > 0 && point.value > 0
            ? ` · ${formatPercent(point.value / shareBase)}`
            : ""}
        </Typography>
      </Box>
    ))}
  </Box>
);

/** How many records the chart could not include, and why. */
const SkippedNote: React.FC<{ count: number }> = ({ count }) => (
  <Typography variant="caption" display="block" color="text.secondary">
    {Format(i18n("db_chart_skipped"), { count })}
  </Typography>
);
