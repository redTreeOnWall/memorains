import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Chip,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import { currentLan, i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import {
  axisDays,
  axisLabels,
  barGeometry,
  daysBetween,
  LEAD_DAYS,
  MAX_AXIS_DAYS,
  planAxis,
  showsDayLabels,
  shiftDayKey,
  todayKey,
} from "./ganttScale";
import { buildGanttPlan } from "./ganttRows";
import { dateValueForDay, WEEK_STARTS_ON } from "./journalDays";
import type { DatabaseBinding } from "./model";
import { optionColorHex } from "./optionColors";
import {
  GANTT_ZOOMS,
  type GanttZoom,
  type PropertyDef,
  type RowData,
} from "./types";

/**
 * The Gantt view: a horizontal timeline with one bar per record.
 *
 * The schedule comes from **two date columns** rather than a new property type, so a
 * start column alone is already a one-day bar per record and nothing about the
 * document has to change to get this view.
 *
 * One number decides the layout: `dayWidth`. The axis, a bar's geometry, the
 * gridlines, the dependency arrows and the drag all derive from it, which is what
 * keeps them from drifting apart — a view that laid a bar out from a second formula
 * ends up a few pixels off after the axis is scrolled.
 *
 * ## Dragging uses pointer events, not HTML5 drag-and-drop
 *
 * A bar is positioned in pixels and has to be *resized* as well as moved, with a live
 * preview that follows the pointer between day boundaries. `dragstart` cannot express
 * any of that, and it never fires for touch input at all. Pointer events with
 * `touch-action: none` are the one path that works for both, which is also why this
 * view has no `draggable` attribute anywhere — mixing the two systems inside one
 * drag surface is how a gesture ends up doing nothing on one of them.
 */

/** Height of one chart row. The gutter and the track both use it to stay aligned. */
const ROW_HEIGHT = 36;
/** Height of the axis: the month band over the day band. */
const AXIS_HEIGHT = 44;
/** Width of the left gutter holding record labels. */
const GUTTER_WIDTH = 190;
/** Hit area at each end of a bar that resizes instead of moving. */
const EDGE_HIT = 8;
/** Narrowest a bar may be drawn, so a one-day bar stays visible at every zoom. */
const MIN_BAR_WIDTH = 6;
/** Size of a milestone diamond. */
const MILESTONE_SIZE = 13;
/** Blank pixels reserved at the right of a fitted axis. */
const FIT_PADDING = 32;

type DragMode = "move" | "start" | "end";

interface DragState {
  mode: DragMode;
  rowId: string;
  /**
   * The bounds the bar is drawn with while the gesture runs.
   *
   * Held as **days**, not as a pixel delta: the drag is snapped to whole days, so the
   * preview shows exactly the value that will be written. The gesture's origin lives in
   * a ref instead (see `dragOrigin`), because the live state is what the render reads
   * and the origin is what the move handler reads.
   */
  previewStart: string;
  previewEnd: string;
}

interface GanttColumns {
  start?: PropertyDef;
  end?: PropertyDef;
  dependency?: PropertyDef;
  milestone?: PropertyDef;
}

export const GanttView: React.FC<{
  binding: DatabaseBinding;
  viewId: string;
  readOnly?: boolean;
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, viewId, readOnly, revision, onOpenRecord }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  /**
   * Which zoom is showing; `null` means "fit", i.e. derive the width from the data.
   *
   * **Local state, not a view setting.** See `GanttZoom` in `types.ts`: which slice of
   * time one person is looking at is a viewport fact, and the journal's week/month/year
   * control is local for the same reason. A shared zoom would also fight the fit mode —
   * every collaborator's window is a different width.
   */
  const [zoom, setZoom] = useState<GanttZoom | null>(null);
  /** Where the user scrolled the axis to; `null` means "follow the data". */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const properties = useMemo(
    () => binding.getViewProperties(viewId),
    [binding, viewId, revision],
  );
  const rows = useMemo(
    () => binding.getViewRows(viewId),
    [binding, viewId, revision],
  );
  const view = useMemo(
    () => binding.getViews().find((candidate) => candidate.id === viewId),
    [binding, viewId, revision],
  );
  const columns: GanttColumns = useMemo(
    () => binding.getViewGanttColumns(viewId),
    [binding, viewId, revision],
  );

  const titleProperty = useMemo(
    () => properties.find((property) => property.type === "title"),
    [properties],
  );

  const titleOf = useCallback(
    (row: RowData) =>
      (titleProperty ? binding.getTextString(row, titleProperty.id) : "") ||
      i18n("db_record_untitled"),
    [binding, titleProperty],
  );
  const dependencyOf = useCallback(
    (row: RowData) => {
      const id = columns.dependency?.id;
      if (!id) return "";
      // Read through the binding, **not** `row.values[id]`: a text cell's row value is
      // the live `Y.Text` object, so a `typeof === "string"` check against it is false
      // for every cell and the whole feature silently resolves to "no dependencies".
      // The plain reader is `getTextString`, which is what every other text read uses.
      return binding.getTextString(row, id);
    },
    [binding, columns.dependency],
  );

  const plan = useMemo(
    () =>
      buildGanttPlan({
        rows,
        startPropId: columns.start?.id,
        endPropId: columns.end?.id,
        milestonePropId: columns.milestone?.id,
        dependencyPropId: columns.dependency?.id,
        titleOf,
        dependencyOf,
      }),
    [rows, columns, titleOf, dependencyOf],
  );

  /** Bars first, then the undated records, so one index addresses both columns. */
  const chartRows = useMemo(
    () => [
      ...plan.bars.map((bar) => ({ row: bar.row, bar })),
      ...plan.unscheduled.map((row) => ({ row, bar: null })),
    ],
    [plan],
  );

  const rowIndexOf = useMemo(() => {
    const index = new Map<string, number>();
    chartRows.forEach((entry, position) => index.set(entry.row.id, position));
    return index;
  }, [chartRows]);

  /** Colour per record, from the view's grouping options. */
  const groupOfRow = useMemo(() => {
    const map = new Map<string, string | undefined>();
    const groupBy = view?.groupBy;
    if (!groupBy) return map;
    for (const group of binding.getViewRowGroups(viewId, groupBy)) {
      for (const row of group.rows) map.set(row.id, group.color);
    }
    return map;
  }, [binding, viewId, view?.groupBy, revision]);

  /**
   * The viewport, measured rather than assumed.
   *
   * The fit zoom needs a real width, and a resize has to re-fit: an axis sized for the
   * old window leaves the chart either padded with empty days or cut off at the right.
   */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Where the axis opens, how long it is and how wide a day is.
   *
   * The data-derived value is what makes the view usable on open — the chart shows the
   * earliest bar rather than a month of empty axis before it. It is also why the axis
   * has to be **pinned** on the first interaction (see `pinAxis`).
   */
  const derivedAxis = useMemo(
    () =>
      planAxis({
        zoom: zoom ?? undefined,
        first: plan.first,
        last: plan.last,
        usableWidth: Math.max(viewportWidth - GUTTER_WIDTH - FIT_PADDING, 0),
      }),
    [zoom, plan.first, plan.last, viewportWidth],
  );
  const axisStart = anchor ?? derivedAxis.anchor;
  const dayWidth = derivedAxis.dayWidth;
  /**
   * Days drawn.
   *
   * From the plan, except after a pan: panning away from the data leaves the plan's own
   * count anchored where the data is, and the axis has to keep covering the viewport it
   * was scrolled into. Extending only forwards from the panned anchor keeps the visible
   * range populated without asking for days before the data that nobody can reach.
   */
  const axisDayCount = useMemo(() => {
    if (!anchor) return derivedAxis.dayCount;
    const usable = Math.max(viewportWidth - GUTTER_WIDTH, 0);
    const viewportDays = Math.ceil(usable / Math.max(dayWidth, 0.5)) + 2;
    const toDataEnd = plan.last
      ? daysBetween(axisStart, plan.last) + LEAD_DAYS + 2
      : 0;
    return Math.max(
      1,
      Math.min(MAX_AXIS_DAYS, Math.max(viewportDays, toDataEnd)),
    );
  }, [
    anchor,
    derivedAxis.dayCount,
    viewportWidth,
    dayWidth,
    axisStart,
    plan.last,
  ]);

  /**
   * Stop deriving the axis from the data.
   *
   * A data-derived anchor follows the earliest bar, which is right until the user moves
   * that bar: without this, dragging the first record of a chart slides every row one
   * way while the dragged bar slides the other, and the bar appears not to move at all
   * even though the write succeeded. Freezing the axis at the moment of the gesture is
   * what makes a drag move the bar and nothing else.
   *
   * One-way, and the Fit control is the way back — see `setZoom`. A "pin only while the
   * gesture lasts" version would re-anchor on release and reproduce exactly the jump
   * this exists to prevent.
   */
  const pinAxis = useCallback(() => {
    setAnchor((current) => current ?? axisStart);
  }, [axisStart]);

  const days = useMemo(
    () => axisDays(axisStart, axisDayCount, WEEK_STARTS_ON),
    [axisStart, axisDayCount],
  );
  const labels = useMemo(
    () =>
      axisLabels(days, dayWidth, currentLan, dayWidth >= 18 ? "long" : "short"),
    [days, dayWidth],
  );

  const axisWidth = axisDayCount * dayWidth;
  const today = todayKey();
  const todayX = daysBetween(axisStart, today) * dayWidth;
  const todayVisible = todayX >= 0 && todayX <= axisWidth;

  const panAxis = (days: number) => setAnchor(shiftDayKey(axisStart, days));

  const scrollToToday = () => {
    setAnchor(shiftDayKey(today, -LEAD_DAYS));
    scrollRef.current?.scrollTo({ left: 0 });
  };

  /**
   * Schedule an undated record on the day that was clicked in its own lane.
   *
   * This is what makes the undated rows usable rather than merely listed. A record with no
   * start day has no bar, so a drag has nothing to grab — but its **lane** is still there,
   * one row tall and ruled by the same day columns the axis above it uses, and clicking a
   * lane is how "this record belongs on that day" is expressed without leaving the view to
   * type a date into the table.
   *
   * **One field is written: the start column.** The end is deliberately left alone, because
   * every alternative moves a date the user typed: shifting an end that would end up before
   * the new start silently rewrites it, and clamping it does the same by another name. If
   * the record already had an end after the clicked day, the span appears by itself; if not,
   * the bar is one day long until the user says otherwise.
   */
  const scheduleOnDay = useCallback(
    (row: RowData, dayKey: string) => {
      const startId = columns.start?.id;
      if (!startId || readOnly) return;
      binding.setValue(row.id, startId, dateValueForDay(dayOf(dayKey)));
    },
    [binding, columns.start, readOnly],
  );

  /**
   * The day key under a viewport x, clamped to the drawn axis.
   *
   * **Floored, not rounded.** A day column spans `[i, i+1)` of a day's width, and a click
   * anywhere in a column means that column — rounding would send the right half of one to
   * the day after it, so clicking the middle of a cell would schedule a record one day
   * late. The floor also survives the drag: both the press and the pointer are resolved the
   * same way, so the difference between them is still the true number of days crossed, and
   * a drag of exactly one day's width moves the bar exactly one day whatever part of the
   * bar was grabbed.
   */
  const axisDayAt = useCallback(
    (clientX: number): string | null => {
      const track = trackRef.current;
      if (!track) return null;
      const offset = (clientX - track.getBoundingClientRect().left) / dayWidth;
      const index = Math.max(0, Math.min(axisDayCount - 1, Math.floor(offset)));
      return shiftDayKey(axisStart, index);
    },
    [axisStart, axisDayCount, dayWidth],
  );

  const beginDrag = (
    event: React.PointerEvent,
    mode: DragMode,
    rowId: string,
    startKey: string,
    endKey: string,
  ) => {
    if (readOnly) return;
    // `preventDefault` stops the drag from turning into a text selection; the
    // `touch-action: none` on the bar stops it from turning into a scroll. Between them
    // the gesture stays a gesture all the way to the release.
    event.preventDefault();
    pinAxis();
    // The gesture's origin: the bar's bounds as they are in the document, and the day
    // the pointer went down on. In a ref because the window-level move handler reads it,
    // and a handler closed over render state would read a stale bar on the next frame.
    dragOrigin.current = {
      pressDay: axisDayAt(event.clientX) ?? startKey,
      startKey,
      endKey,
    };
    setDrag({
      mode,
      rowId,
      previewStart: startKey,
      previewEnd: endKey,
    });
  };

  /**
   * Follow the pointer with the part of the bar that was grabbed.
   *
   * All three modes are **delta-based**: the day the pointer is over is compared with
   * the day it was pressed on, and that whole-day offset is applied to the bar's
   * original bounds. Measuring the target day absolutely instead would inherit the
   * press position's rounding — the pointer goes down *somewhere inside* a day, and for
   * the end edge, whose pixel position is that day's right boundary, "somewhere inside"
   * is past the midpoint and rounds forward. That cost a day on every resize.
   *
   * A move keeps the duration and slides both ends together. A resize moves one end and
   * clamps it against the other, so a bar can never be dragged inside out — the reader
   * would draw a one-day bar for it anyway, and the preview agreeing with what gets
   * written is the whole point of previewing.
   *
   * Read through refs rather than through `drag` state: the move handler is attached to
   * the window once per gesture (see below), so it must not be re-created on every
   * pointer move, and a stale closure over `drag` would drop every second frame.
   */
  const moveDrag = useCallback(
    (event: PointerEvent) => {
      const current = dragRef.current;
      const origin = dragOrigin.current;
      if (!current || !origin) return;
      const day = axisDayAt(event.clientX);
      if (!day) return;

      const delta = daysBetween(origin.pressDay, day);
      let next: { previewStart: string; previewEnd: string };
      if (current.mode === "move") {
        next = {
          previewStart: shiftDayKey(origin.startKey, delta),
          previewEnd: shiftDayKey(origin.endKey, delta),
        };
      } else if (current.mode === "start") {
        next = {
          previewStart: minKey(
            shiftDayKey(origin.startKey, delta),
            origin.endKey,
          ),
          previewEnd: origin.endKey,
        };
      } else {
        next = {
          previewStart: origin.startKey,
          previewEnd: maxKey(
            shiftDayKey(origin.endKey, delta),
            origin.startKey,
          ),
        };
      }

      if (
        next.previewStart === current.previewStart &&
        next.previewEnd === current.previewEnd
      )
        return;
      setDrag((latest) => (latest ? { ...latest, ...next } : latest));
    },
    [axisDayAt],
  );

  /**
   * Commit the gesture, once.
   *
   * One write per field on pointerup rather than one per pointer move: a thirty-frame
   * drag would otherwise be thirty CRDT updates broadcast to every collaborator and
   * thirty re-reads of the whole table.
   *
   * Only the dragged row's own date fields are written, so two people dragging
   * different bars touch disjoint keys and both survive — the same single-field rule a
   * board card drop follows. A field whose day did not change is left alone rather than
   * rewritten to the same value, because every write is a broadcast.
   */
  const endDrag = useCallback(() => {
    const current = dragRef.current;
    const origin = dragOrigin.current;
    // Cleared before any early return, so a gesture can never leave an origin behind for
    // the next one to inherit.
    dragOrigin.current = null;
    setDrag(null);
    if (!current || !origin || readOnly || !columns.start) return;

    const startId = columns.start.id;
    if (current.mode !== "end" && current.previewStart !== origin.startKey) {
      binding.setValue(
        current.rowId,
        startId,
        dateValueForDay(dayOf(current.previewStart)),
      );
    }

    const endId = columns.end?.id;
    // Without an end column there is nothing to resize, and `move` is just the start
    // write above — which is exactly the one-day-bar semantics the view documents.
    if (!endId || current.mode === "start") return;
    // `move` writes both ends, which is what keeps the duration: a drag that moved only
    // the start would silently resize the bar while looking like a move.
    if (current.mode === "move" && current.previewEnd !== origin.endKey) {
      binding.setValue(
        current.rowId,
        endId,
        dateValueForDay(dayOf(current.previewEnd)),
      );
      return;
    }
    if (current.mode === "end" && current.previewEnd !== origin.endKey) {
      binding.setValue(
        current.rowId,
        endId,
        dateValueForDay(dayOf(current.previewEnd)),
      );
    }
  }, [binding, columns, readOnly]);

  /**
   * Keep the gesture's live state in refs as well as in React state.
   *
   * The move and release handlers are installed on the **window** for the duration of a
   * gesture: the pointer routinely leaves the bar it grabbed (a left-edge resize does so
   * immediately) and can be released anywhere on the page, and neither `setPointerCapture`
   * nor a handler on the bar survives that reliably — capture demands a live pointer id
   * and throws for one it does not recognise, which would abort the drag handler itself.
   *
   * Refs rather than state because these listeners are added once per gesture: a handler
   * recreated on every render would need re-attaching on every pointer move, and one
   * closed over `drag` would read a stale bar on the next frame.
   */
  const dragRef = useRef<DragState | null>(null);
  const dragOrigin = useRef<{
    pressDay: string;
    startKey: string;
    endKey: string;
  } | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    // `once` on neither: the move handler has to run for the whole gesture, and the
    // release handlers are removed in the cleanup below.
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [drag !== null, moveDrag, endDrag]);

  if (!view) return null;

  const wrongColumn = view.startProp
    ? !columns.start &&
      properties.some((property) => property.id === view.startProp)
    : false;

  if (!columns.start) {
    // Reachable for a **viewer** — creation is a schema write and a viewer has none —
    // and for an editor whose start column was deleted or retyped by a collaborator
    // while this view was open. An editor normally never sees it: switching the layout
    // grants the column, the same rule the journal follows (see `switchLayout`).
    return (
      <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
        <Typography variant="body2">{i18n("db_gantt_needs_date")}</Typography>
        <Typography variant="caption" display="block" sx={{ mb: 1 }}>
          {i18n("db_gantt_needs_date_hint")}
        </Typography>
        {wrongColumn ? (
          <Typography variant="caption" display="block" color="warning.main">
            {i18n("db_gantt_needs_date_settings")}
          </Typography>
        ) : null}
      </Box>
    );
  }

  const chartHeight = Math.max(chartRows.length, 1) * ROW_HEIGHT;
  const violatedCount = plan.links.filter((link) => link.violated).length;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          flexWrap: "wrap",
        }}
      >
        <IconButton
          size="small"
          onClick={() => panAxis(-Math.max(1, Math.round(axisDayCount / 2)))}
          aria-label={i18n("db_gantt_prev")}
        >
          <ChevronLeftRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => panAxis(Math.max(1, Math.round(axisDayCount / 2)))}
          aria-label={i18n("db_gantt_next")}
        >
          <ChevronRightRoundedIcon fontSize="small" />
        </IconButton>
        <Tooltip title={i18n("db_gantt_today")}>
          <IconButton
            size="small"
            onClick={scrollToToday}
            aria-label={i18n("db_gantt_today")}
          >
            <TodayRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* Which zoom is showing is **local** state, unlike every other control in this
            toolbar — see `GanttZoom`. "Fit" is a real choice rather than a missing
            setting: it re-derives the width from the data every render, so a chart left
            on fit keeps fitting as records are added. It is also the way back to a
            data-derived axis after panning or dragging has pinned one. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={zoom ?? "fit"}
          onChange={(_event, value: GanttZoom | "fit" | null) => {
            if (!value) return;
            setZoom(value === "fit" ? null : value);
            if (value === "fit") setAnchor(null);
          }}
        >
          {GANTT_ZOOMS.map((zoom) => (
            <ToggleButton
              key={zoom}
              value={zoom}
              sx={{ textTransform: "none", px: 1.25 }}
            >
              {i18n(`db_gantt_zoom_${zoom}` as "db_gantt_zoom_week")}
            </ToggleButton>
          ))}
          <ToggleButton value="fit" sx={{ textTransform: "none", px: 1.25 }}>
            {i18n("db_gantt_zoom_fit")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box
        ref={scrollRef}
        sx={{
          overflowX: "auto",
          overflowY: "hidden",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          // Kept off the labels: a pointer drag that crosses the gutter is still a
          // drag, and selecting the text it passes over would cancel it.
          userSelect: drag ? "none" : "auto",
        }}
      >
        {/* Two full-width columns, the gutter and the track, each row of which is
            exactly `ROW_HEIGHT` tall. That shared constant is what keeps a label and
            its bar on the same line without measuring anything. */}
        <Box sx={{ width: GUTTER_WIDTH + axisWidth, minWidth: "100%" }}>
          <Box
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              display: "flex",
              height: AXIS_HEIGHT,
              backgroundColor: "background.paper",
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Box
              sx={{
                width: GUTTER_WIDTH,
                flexShrink: 0,
                position: "sticky",
                left: 0,
                zIndex: 2,
                backgroundColor: "background.paper",
                borderRight: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "flex-end",
                px: 1,
                pb: 0.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {i18n("db_gantt_record")}
              </Typography>
            </Box>

            <Box sx={{ position: "relative", width: axisWidth }}>
              {labels.map((label) => (
                <Typography
                  key={`${label.x}-${label.text}`}
                  variant="caption"
                  noWrap
                  sx={{
                    position: "absolute",
                    left: label.x + 4,
                    top: 4,
                    maxWidth: Math.max(label.width - 8, 0),
                    fontSize: 11,
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  {label.text}
                </Typography>
              ))}

              {/* Day numbers only where they fit: at the quarter zoom a column is
                  three pixels wide and a digit would be a smear. */}
              {showsDayLabels(dayWidth) ? (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 18,
                  }}
                >
                  {days.map((day, index) => (
                    <Typography
                      key={day.key}
                      variant="caption"
                      sx={{
                        position: "absolute",
                        left: index * dayWidth,
                        width: dayWidth,
                        textAlign: "center",
                        fontSize: 10,
                        lineHeight: "18px",
                        color: day.isToday ? "primary.main" : "text.disabled",
                        fontWeight: day.isToday ? 700 : 400,
                      }}
                    >
                      {day.label}
                    </Typography>
                  ))}
                </Box>
              ) : null}
            </Box>
          </Box>

          <Box sx={{ display: "flex" }}>
            <Box
              sx={{
                width: GUTTER_WIDTH,
                flexShrink: 0,
                position: "sticky",
                left: 0,
                zIndex: 2,
                backgroundColor: "background.paper",
                borderRight: "1px solid",
                borderColor: "divider",
              }}
            >
              {chartRows.map(({ row, bar }) => (
                <RecordLabel
                  key={row.id}
                  title={titleOf(row)}
                  color={groupOfRow.get(row.id)}
                  unscheduled={bar === null}
                  onClick={() => onOpenRecord(row.id)}
                />
              ))}
            </Box>

            <Box
              ref={trackRef}
              sx={{
                position: "relative",
                width: axisWidth,
                height: chartHeight,
              }}
            >
              {/* Gridlines and the today marker, behind the bars and without pointer
                  events, so a bar is never competing with a line for the gesture. */}
              <Box
                sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                aria-hidden
              >
                {days.map((day, index) =>
                  day.monthStart || day.weekStart ? (
                    <Box
                      key={day.key}
                      sx={{
                        position: "absolute",
                        left: index * dayWidth,
                        top: 0,
                        bottom: 0,
                        width: "1px",
                        backgroundColor: day.monthStart
                          ? "divider"
                          : "action.hover",
                      }}
                    />
                  ) : null,
                )}
                {todayVisible ? (
                  <Box
                    sx={{
                      position: "absolute",
                      left: todayX,
                      top: 0,
                      bottom: 0,
                      width: "2px",
                      backgroundColor: "primary.main",
                      opacity: 0.45,
                    }}
                  />
                ) : null}
              </Box>

              {chartRows.map(({ row, bar }, index) => (
                <Box
                  key={row.id}
                  // Only an **undated** lane is a click target. A dated row's lane is empty
                  // space beside its own bar, and making it schedule-by-click would turn a
                  // near-miss on the bar into a silent date change.
                  onClick={
                    bar === null
                      ? (event) => {
                          const day = axisDayAt(event.clientX);
                          if (day) scheduleOnDay(row, day);
                        }
                      : undefined
                  }
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: index * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    borderBottom: "1px solid",
                    borderColor: "action.hover",
                    backgroundColor:
                      drag?.rowId === row.id ? "action.hover" : "transparent",
                    cursor: bar === null && !readOnly ? "copy" : undefined,
                    // The lane a click would land in is tinted, so the target is visible
                    // before the click rather than guessed at. A dated lane does not light
                    // up, which is what says "this one is not clickable".
                    "&:hover":
                      bar === null && !readOnly
                        ? { backgroundColor: "action.hover" }
                        : undefined,
                  }}
                />
              ))}

              <svg
                width={axisWidth}
                height={chartHeight}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  pointerEvents: "none",
                }}
              >
                <defs>
                  <marker
                    id="gantt-arrow"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 z" fill="#90a4ae" />
                  </marker>
                </defs>
                {plan.links.map((link) => {
                  const fromIndex = rowIndexOf.get(link.fromRowId);
                  const toIndex = rowIndexOf.get(link.rowId);
                  if (fromIndex === undefined || toIndex === undefined)
                    return null;
                  const fromBar = plan.bars[fromIndex];
                  const toBar = plan.bars[toIndex];
                  if (!fromBar || !toBar) return null;

                  const fromGeometry = barGeometry(
                    fromBar.start,
                    fromBar.end,
                    axisStart,
                    dayWidth,
                  );
                  const toGeometry = barGeometry(
                    toBar.start,
                    toBar.end,
                    axisStart,
                    dayWidth,
                  );
                  const fromX = fromGeometry.x + fromGeometry.width;
                  const toX = toGeometry.x;
                  const fromY = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const toY = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                  // The elbow sits halfway, but never inside either bar: a link that
                  // turned inside a neighbour would read as attached to the wrong one.
                  const elbowX = Math.max(
                    fromX + 8,
                    Math.min(toX - 8, (fromX + toX) / 2),
                  );
                  return (
                    <path
                      key={`${link.rowId}-${link.fromRowId}`}
                      d={`M ${fromX} ${fromY} L ${elbowX} ${fromY} L ${elbowX} ${toY} L ${toX} ${toY}`}
                      fill="none"
                      stroke={link.violated ? "#e53935" : "#90a4ae"}
                      strokeWidth={1.5}
                      strokeDasharray={link.violated ? "4 3" : undefined}
                      markerEnd="url(#gantt-arrow)"
                    />
                  );
                })}
              </svg>

              {chartRows.map(({ row, bar }) => {
                if (!bar) return null;
                const index = rowIndexOf.get(row.id) ?? 0;
                const isDragging = drag?.rowId === row.id;
                const preview = isDragging ? drag : null;

                const shownStart = preview ? preview.previewStart : bar.start;
                const shownEnd = preview ? preview.previewEnd : bar.end;

                const geometry = barGeometry(
                  shownStart,
                  shownEnd,
                  axisStart,
                  dayWidth,
                );
                const color = optionColorHex(
                  groupOfRow.get(row.id) ?? "macaron-blue",
                );
                const centerY = index * ROW_HEIGHT + ROW_HEIGHT / 2;

                if (bar.milestone) {
                  const centerX = geometry.x + dayWidth / 2;
                  return (
                    <Tooltip
                      key={row.id}
                      title={Format(i18n("db_gantt_milestone_tip"), {
                        name: titleOf(row),
                        date: shownStart,
                      })}
                      arrow
                    >
                      <Box
                        onPointerDown={(event) =>
                          beginDrag(event, "move", row.id, bar.start, bar.end)
                        }
                        onDoubleClick={() => onOpenRecord(row.id)}
                        sx={{
                          position: "absolute",
                          left: centerX - MILESTONE_SIZE / 2,
                          top: centerY - MILESTONE_SIZE / 2,
                          width: MILESTONE_SIZE,
                          height: MILESTONE_SIZE,
                          // A diamond is a square turned 45°, which is what a milestone
                          // is on every chart a reader has seen before.
                          transform: "rotate(45deg)",
                          borderRadius: "2px",
                          backgroundColor: color,
                          border: "1px solid",
                          borderColor: "rgba(0, 0, 0, 0.16)",
                          cursor: readOnly ? "pointer" : "grab",
                          touchAction: "none",
                          boxShadow: isDragging
                            ? "0 3px 10px rgba(0, 0, 0, 0.2)"
                            : "none",
                        }}
                      />
                    </Tooltip>
                  );
                }

                return (
                  <Tooltip
                    key={row.id}
                    title={`${titleOf(row)} · ${shownStart}${shownEnd !== shownStart ? ` → ${shownEnd}` : ""}`}
                    arrow
                  >
                    <Box
                      data-gantt-bar={row.id}
                      onPointerDown={(event) =>
                        beginDrag(event, "move", row.id, bar.start, bar.end)
                      }
                      onDoubleClick={() => onOpenRecord(row.id)}
                      sx={{
                        position: "absolute",
                        left: geometry.x,
                        top: centerY - 11,
                        width: Math.max(geometry.width, MIN_BAR_WIDTH),
                        height: 22,
                        borderRadius: "5px",
                        backgroundColor: color,
                        border: "1px solid",
                        borderColor: "rgba(0, 0, 0, 0.12)",
                        cursor: readOnly ? "pointer" : "grab",
                        opacity: isDragging ? 0.9 : 1,
                        boxShadow: isDragging
                          ? "0 4px 12px rgba(0, 0, 0, 0.2)"
                          : "0 1px 2px rgba(0, 0, 0, 0.06)",
                        touchAction: "none",
                        "&:hover": { filter: "brightness(0.97)" },
                        "&:hover .gantt-edge": { opacity: 1 },
                      }}
                    >
                      {!readOnly ? (
                        <>
                          <Box
                            className="gantt-edge"
                            onPointerDown={(event) => {
                              // The bar's own handler would otherwise fire too, and the
                              // gesture would resize *and* move.
                              event.stopPropagation();
                              beginDrag(
                                event,
                                "start",
                                row.id,
                                bar.start,
                                bar.end,
                              );
                            }}
                            sx={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: Math.min(
                                EDGE_HIT,
                                Math.max(geometry.width / 2, 3),
                              ),
                              borderTopLeftRadius: "5px",
                              borderBottomLeftRadius: "5px",
                              cursor: "w-resize",
                              opacity: 0,
                              backgroundColor: "rgba(0, 0, 0, 0.14)",
                            }}
                          />
                          <Box
                            className="gantt-edge"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              beginDrag(
                                event,
                                "end",
                                row.id,
                                bar.start,
                                bar.end,
                              );
                            }}
                            sx={{
                              position: "absolute",
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: Math.min(
                                EDGE_HIT,
                                Math.max(geometry.width / 2, 3),
                              ),
                              borderTopRightRadius: "5px",
                              borderBottomRightRadius: "5px",
                              cursor: "e-resize",
                              opacity: 0,
                              backgroundColor: "rgba(0, 0, 0, 0.14)",
                            }}
                          />
                        </>
                      ) : null}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
          minHeight: 20,
        }}
      >
        {plan.bars.length ? (
          <Chip
            size="small"
            variant="outlined"
            label={Format(i18n("db_gantt_scheduled_count"), {
              count: plan.bars.length,
            })}
          />
        ) : null}

        {plan.unscheduled.length ? (
          <Tooltip title={i18n("db_gantt_no_start_hint")} arrow>
            <Chip
              size="small"
              variant="outlined"
              color="default"
              label={Format(i18n("db_gantt_unscheduled_count"), {
                count: plan.unscheduled.length,
              })}
            />
          </Tooltip>
        ) : null}

        {violatedCount ? (
          <Tooltip title={i18n("db_gantt_violated_hint")} arrow>
            <Chip
              size="small"
              variant="outlined"
              color="warning"
              label={Format(i18n("db_gantt_violated_count"), {
                count: violatedCount,
              })}
            />
          </Tooltip>
        ) : null}

        <Box sx={{ flex: 1 }} />

        {!readOnly ? (
          <Tooltip title={i18n("db_add_row")}>
            <IconButton
              size="small"
              onClick={() => binding.addRow()}
              aria-label={i18n("db_add_row")}
              sx={{ color: "text.secondary" }}
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
};

/**
 * One record's label in the left gutter, aligned with its own row of the chart.
 *
 * Clicking the label opens the record whether or not it is dated — that is the fast path
 * to the panel, and the record's dates are editable there. The lane beside an undated
 * label is separately clickable to place it on a day; see `scheduleOnDay`.
 */
const RecordLabel: React.FC<{
  title: string;
  color?: string;
  /** No usable start date, so the row sits below the bars and is dimmed. */
  unscheduled?: boolean;
  onClick: () => void;
}> = ({ title, color, unscheduled, onClick }) => (
  <Box
    onClick={onClick}
    sx={{
      height: ROW_HEIGHT,
      display: "flex",
      alignItems: "center",
      gap: 0.75,
      px: 1,
      cursor: "pointer",
      borderBottom: "1px solid",
      borderColor: "action.hover",
      "&:hover": { backgroundColor: "action.hover" },
    }}
  >
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: "2px",
        flexShrink: 0,
        backgroundColor: color ? optionColorHex(color) : "transparent",
        border: color ? "none" : "1px dashed",
        borderColor: "divider",
      }}
    />
    <Typography
      variant="caption"
      noWrap
      sx={{
        fontWeight: 500,
        color: unscheduled ? "text.disabled" : "text.primary",
      }}
    >
      {title}
    </Typography>
    {unscheduled ? (
      // The badge names the state; the tooltip says what to do about it, which is the
      // part that is not visible: the badge is on the label and the click target is the
      // lane beside it.
      <Tooltip
        title={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <span>{i18n("db_gantt_no_start")}</span>
            <span>{i18n("db_gantt_no_start_hint")}</span>
          </Box>
        }
        arrow
        placement="right"
      >
        <Box
          component="span"
          sx={{
            ml: "auto",
            fontSize: 10,
            color: "text.disabled",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "4px",
            px: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          {i18n("db_gantt_no_start")}
        </Box>
      </Tooltip>
    ) : null}
  </Box>
);

/** Local midnight of a day key, for writing back through `dateValueForDay`. */
function dayOf(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);
