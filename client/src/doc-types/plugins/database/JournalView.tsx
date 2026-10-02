import React, { useCallback, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Popover,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { i18n } from "../../../internationnalization/utils";
import { useLocale } from "../../../hooks/hooks";
import Format from "string-format";
import {
  CardDetailLine,
  cardDetailProperties,
  cardTitleLine,
  cardTitleProperty,
} from "./cards";
import { CompletionRing } from "./CompletionRing";
import {
  buildDayIndex,
  checkedCount,
  computeOptionStreaks,
  computeOptionYear,
  dateValueForDay,
  dayKeyFromDate,
  isSameDay,
  isSameMonth,
  monthGridDays,
  monthName,
  periodLabel,
  rankJournalDetails,
  shiftPeriod,
  startOfDay,
  weekDays,
  yearWeeks,
  WEEK_STARTS_ON,
  weekdayNames,
  type DayKey,
} from "./journalDays";
import type { DatabaseBinding } from "./model";
import { optionChipSx, optionColorHex, shadeHex } from "./optionColors";
import type { OptionDef, PropertyDef, RowData } from "./types";

/**
 * The journal view: a day-to-day record book.
 *
 * A week / month / year grid where **each cell is one local calendar day**. It is
 * deliberately not a scheduling calendar — no time-of-day axis, no durations, no
 * overlapping events — which is what keeps it as cheap as the board view instead of
 * requiring interval layout.
 *
 * Clicking a day opens the record already on it, or creates one there and opens it:
 * one gesture from "I want to note something" to typing.
 */

type Scale = "week" | "month" | "year";

/** What one calendar day holds, precomputed so a cell does no searching. */
interface DayBucket {
  /** The record the cell shows: the first in the view's own order. */
  primary: RowData | null;
  /** How many further records fall on the same day. */
  hidden: number;
}

const EMPTY_BUCKET: DayBucket = { primary: null, hidden: 0 };

/** Properties shown on a day cell in the week and month grids. */
const MONTH_DETAILS = 2;
const WEEK_DETAILS = 5;

/**
 * How many secondary properties a **narrow** month cell can show.
 *
 * Zero: at ~48px per cell there is no room for a value, and a truncated fragment
 * reads as noise. The cell carries the day, a dot for "something here", and the
 * ring; opening it shows the contents.
 */
const MONTH_DETAILS_COMPACT = 0;

export const JournalView: React.FC<{
  binding: DatabaseBinding;
  viewId: string;
  readOnly?: boolean;
  revision: number;
  onOpenRecord: (rowId: string) => void;
  /**
   * Create the missing date column, when an editor asks for it.
   *
   * Supplied by the editor rather than done here, so that the journal's date column
   * is created in exactly **one** place — and that place stays a user event handler.
   * A view that created the column while rendering would add it for every
   * collaborator.
   */
  onCreateCalendarProperty?: () => void;
}> = ({
  binding,
  viewId,
  readOnly,
  revision,
  onOpenRecord,
  onCreateCalendarProperty,
}) => {
  const locale = useLocale();
  const [scale, setScale] = useState<Scale>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  /**
   * Which habit's year popover is open, and the chip it was opened from.
   *
   * Both are tracked together so an open popover always has a valid anchor: rendering
   * one without an `anchorEl` is an MUI error. Same shape as the view-settings popovers.
   */
  const [yearPopover, setYearPopover] = useState<{
    option: OptionDef;
    anchor: HTMLElement;
  } | null>(null);

  const properties = useMemo(
    () => binding.getViewProperties(viewId),
    [binding, viewId, revision],
  );
  const rows = useMemo(
    () => binding.getViewRows(viewId),
    [binding, viewId, revision],
  );

  /**
   * Resolved, never read from `view.calendarProp` directly.
   *
   * The stored id can be absent (meaning "choose one") or dangling (the column was
   * deleted), and the resolver handles both. With no resolver hit there is no column
   * to write a day into, so record creation is refused rather than guessed at.
   */
  const calendarProperty = useMemo(
    () => binding.getViewCalendarProperty(viewId),
    [binding, viewId, revision],
  );
  const checklistProperty = useMemo(
    () => binding.getViewChecklistProperty(viewId),
    [binding, viewId, revision],
  );

  /**
   * Streaks are read from **today**, not from the grid's anchor.
   *
   * The bar answers "how long have I kept this up", which is a fact about now. It
   * stays put while the user pages through months — and, for the same reason, does not
   * belong in a day cell.
   */
  const hideStreaks = useMemo(
    () =>
      binding.getViews().find((candidate) => candidate.id === viewId)
        ?.hideStreaks ?? false,
    [binding, viewId, revision],
  );

  const streaks = useMemo(() => {
    if (!calendarProperty || !checklistProperty) return null;
    const options = checklistProperty.options;
    if (!options.length) return null;
    return computeOptionStreaks(
      rows,
      calendarProperty.id,
      checklistProperty.id,
      options.map((option) => option.id),
      new Date(),
    );
  }, [rows, calendarProperty, checklistProperty]);

  const weekStartsOn = WEEK_STARTS_ON;

  /**
   * Narrow viewport (phone).
   *
   * Month and week both change shape rather than merely shrinking: seven columns of
   * 40–50px cannot show a record, and a 300px-tall week column is worse than useless
   * on a phone. The month keeps its 7-column grid (a month *is* a grid) but drops the
   * contents down to a day number plus an indicator; the week becomes a vertical
   * list, which is the shape that fits and reads.
   */
  const isNarrow = useMediaQuery((theme) => theme.breakpoints.down("sm"));

  /** One pass over the rows, then an O(1) lookup per cell. */
  const dayIndex = useMemo(() => {
    const index = new Map<DayKey, DayBucket>();
    if (!calendarProperty) return index;
    // `buildDayIndex` is the single pass; each bucket keeps the view's own order,
    // so the record a cell shows is the one the view's sorts put first rather than
    // whichever happened to be inserted first.
    buildDayIndex(rows, calendarProperty.id).forEach((records, key) => {
      index.set(key, {
        primary: records[0] ?? null,
        // One record per day is the norm. More is legal but only one is shown, and
        // hidden data is disclosed rather than silently dropped.
        hidden: Math.max(0, records.length - 1),
      });
    });
    return index;
  }, [calendarProperty, rows]);

  const bucketFor = useCallback(
    (day: Date): DayBucket => dayIndex.get(dayKeyFromDate(day)) ?? EMPTY_BUCKET,
    [dayIndex],
  );

  /**
   * Open the record on a day, or create one there.
   *
   * The new row id goes straight to the panel: re-reading to find it would race the
   * editor's "close the panel if the record disappeared" effect, which could close
   * the panel this click just opened.
   */
  const openDay = useCallback(
    (day: Date) => {
      const bucket = bucketFor(day);
      if (bucket.primary) {
        onOpenRecord(bucket.primary.id);
        return;
      }
      if (readOnly || !calendarProperty) return;
      onOpenRecord(
        binding.addRow({ [calendarProperty.id]: dateValueForDay(day) }),
      );
    },
    [binding, bucketFor, calendarProperty, onOpenRecord, readOnly],
  );

  const titleProperty = cardTitleProperty(properties);

  /**
   * The properties a day cell may show, with the calendar column ranked last.
   *
   * Not excluded: a user who turned the date column on has asked to see it, and
   * `visibleProps` remains the only authority on what a view shows. But a cell has
   * room for only a couple of values, and the date is the one the cell already
   * states — so it sorts to the end and is the first value dropped when the limit
   * bites, instead of pushing out a real field like `Status` or `Notes`.
   *
   * The checklist column is deliberately not ranked: the ring summarises it, and
   * which habits are ticked is exactly what the cell is for.
   */
  const rankedProperties = useMemo(
    () => rankJournalDetails(properties, calendarProperty?.id),
    [properties, calendarProperty],
  );

  const shared = {
    bucketFor,
    binding,
    titleProperty,
    detailProperties: rankedProperties,
    checklistProperty,
    onOpenDay: openDay,
    compact: isNarrow,
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {!calendarProperty ? (
        // No date column at all, so there is no axis to lay records on. Normal for a
        // viewer, and reachable by an editor when the column was deleted — here or by
        // a collaborator — while this view was open. An editor is offered the fix
        // rather than left in a dead end; creating it stays a user action.
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
          <Typography variant="body2">
            {i18n("db_journal_needs_date")}
          </Typography>
          <Typography variant="caption" display="block" sx={{ mb: 2 }}>
            {i18n("db_journal_needs_date_hint")}
          </Typography>
          {!readOnly && onCreateCalendarProperty ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddRoundedIcon />}
              onClick={onCreateCalendarProperty}
            >
              {i18n("db_journal_create_date_column")}
            </Button>
          ) : null}
        </Box>
      ) : (
        <>
          {/* Two rows on a phone, one on a wider screen. The period label is the
              thing that must not be truncated — "27 Sept – 3 Oct 2026" is the only
              statement of *when* the grid is showing — so on a narrow viewport it
              moves to its own line and the controls share the first. `order` plus
              `flexBasis` does that without duplicating any control. */}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", order: 1 }}>
              <IconButton
                size="small"
                onClick={() =>
                  setAnchor((current) => shiftPeriod(current, scale, -1))
                }
                aria-label={i18n("db_journal_prev")}
              >
                <ChevronLeftRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() =>
                  setAnchor((current) => shiftPeriod(current, scale, 1))
                }
                aria-label={i18n("db_journal_next")}
              >
                <ChevronRightRoundedIcon fontSize="small" />
              </IconButton>
              <Button
                size="small"
                onClick={() => setAnchor(startOfDay(new Date()))}
                sx={{ textTransform: "none", minWidth: 0, px: 1 }}
              >
                {i18n("db_journal_today")}
              </Button>
            </Box>

            <Typography
              variant="subtitle2"
              noWrap
              sx={{
                order: { xs: 3, sm: 2 },
                flexBasis: { xs: "100%", sm: "auto" },
                flexGrow: { xs: 0, sm: 1 },
                minWidth: 0,
                fontWeight: 600,
                px: { xs: 0.5, sm: 1 },
              }}
            >
              {periodLabel(anchor, scale, locale, weekStartsOn)}
            </Typography>

            <ToggleButtonGroup
              size="small"
              exclusive
              value={scale}
              onChange={(_event, value: Scale | null) =>
                value && setScale(value)
              }
              sx={{ order: { xs: 2, sm: 3 }, ml: "auto" }}
            >
              {(["week", "month", "year"] as const).map((value) => (
                <ToggleButton
                  key={value}
                  value={value}
                  sx={{ textTransform: "none", px: { xs: 1, sm: 1.5 } }}
                >
                  {i18n(`db_journal_${value}` as "db_journal_week")}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {streaks && !hideStreaks && checklistProperty ? (
            <StreakBar
              streaks={streaks}
              options={checklistProperty.options}
              onOpenYear={(option, anchorEl) =>
                setYearPopover({ option, anchor: anchorEl })
              }
            />
          ) : null}

          {scale === "month" ? (
            <MonthGrid
              {...shared}
              anchor={anchor}
              weekStartsOn={weekStartsOn}
              detailLimit={isNarrow ? MONTH_DETAILS_COMPACT : MONTH_DETAILS}
            />
          ) : scale === "week" ? (
            <WeekStrip
              {...shared}
              anchor={anchor}
              weekStartsOn={weekStartsOn}
              detailLimit={WEEK_DETAILS}
            />
          ) : (
            <YearGrid
              anchor={anchor}
              bucketFor={bucketFor}
              checklistProperty={checklistProperty}
              onOpenDay={openDay}
              weekStartsOn={weekStartsOn}
            />
          )}

          {!readOnly ? (
            <Box>
              <Button
                size="small"
                startIcon={<AddRoundedIcon />}
                onClick={() => binding.addRow()}
              >
                {i18n("db_add_row")}
              </Button>
            </Box>
          ) : null}
        </>
      )}

      {/* Outside the `calendarProperty` branch: the chip that opens it only exists when a
          calendar column does, but unmounting the popover mid-fade would flash. */}
      {yearPopover ? (
        <OptionYearPopover
          rows={rows}
          calendarProperty={calendarProperty}
          checklistProperty={checklistProperty}
          option={yearPopover.option}
          anchor={yearPopover.anchor}
          onClose={() => setYearPopover(null)}
        />
      ) : null}
    </Box>
  );
};

/**
 * Consecutive-day counts for the journal's checklist column, one chip per option.
 *
 * Read from today rather than from the anchor the grid is showing: this answers "how long
 * have I kept this up", which is a fact about now and does not change as the user pages
 * through months. That is also why it is a bar above the grid rather than a badge in a
 * day cell — a cell belongs to a day, and a streak does not.
 *
 * Every option gets a chip, including the ones at zero: a habit with a broken streak is
 * still a habit the user tracks, and hiding it would silently shrink the bar to the
 * habits that happen to be going well.
 *
 * The trailing question mark explains the one rule that cannot be inferred from the bar:
 * that an unticked **today** does not break a run. Without it, a user who opens the
 * journal in the morning sees the same number as last night and cannot tell whether the
 * app is counting today at all.
 */
const StreakBar: React.FC<{
  streaks: Map<string, number>;
  options: readonly OptionDef[];
  onOpenYear: (option: OptionDef, anchor: HTMLElement) => void;
}> = ({ streaks, options, onOpenYear }) => (
  <Box
    sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}
  >
    {options.map((option) => {
      const count = streaks.get(option.id) ?? 0;
      return (
        <Tooltip
          key={option.id}
          title={i18n("db_journal_streak_view_year")}
          placement="top"
          arrow
        >
          <Chip
            size="small"
            onClick={(event) => onOpenYear(option, event.currentTarget)}
            label={
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 0.5,
                }}
              >
                <span>{option.name}</span>
                {/* Muted at zero so the eye lands on the runs that are alive, while the
                    option itself stays visible. */}
                <Box
                  component="span"
                  sx={{ fontWeight: 700, opacity: count ? 1 : 0.5 }}
                >
                  {Format(i18n("db_journal_streak_days"), { count })}
                </Box>
              </Box>
            }
            sx={{ ...optionChipSx(option.color), cursor: "pointer" }}
          />
        </Tooltip>
      );
    })}
    <Tooltip
      // A custom node rather than a string: the rule needs a line of its own to read as
      // a rule, and MUI renders a plain string as one unbroken paragraph.
      title={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          <span>{i18n("db_journal_streak_help")}</span>
          <span>{i18n("db_journal_streak_help_today")}</span>
        </Box>
      }
      placement="top"
      arrow
    >
      <IconButton
        size="small"
        aria-label={i18n("db_journal_streak_help")}
        sx={{ color: "text.secondary" }}
      >
        <HelpOutlineRoundedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  </Box>
);

const YEAR_DAY = 11;
const YEAR_GAP = 3;

/**
 * One habit's year as a week-by-week heatmap.
 *
 * Columns are weeks and rows are weekdays, the shape that makes a run read as an
 * unbroken horizontal bar — the whole point of showing a year at all. This is not the
 * journal's own Year scale: that one is twelve mini-calendars of **all** records, which
 * is a different question ("what did I note, when") from this one ("when did I do this
 * one thing").
 *
 * The grid scrolls horizontally on a narrow screen rather than reflowing. A year is 53
 * columns whatever the viewport, so the alternative would be a second layout that draws
 * the same data a different way — and a year is exactly the case where seeing the whole
 * run at once is the information.
 */
const OptionYearHeatmap: React.FC<{
  option: OptionDef;
  year: number;
  days: Set<DayKey>;
  weekStartsOn: number;
}> = ({ option, year, days, weekStartsOn }) => {
  const locale = useLocale();
  const todayKey = dayKeyFromDate(new Date());
  const fill = optionColorHex(option.color);
  // Shaded rather than used flat: a pale macaron fill at 11px has almost no contrast
  // against the surface, and this is a density display where the filled squares are the
  // only thing being read.
  const onFill = shadeHex(fill, 0.25);
  const weeks = useMemo(
    () => yearWeeks(year, weekStartsOn),
    [year, weekStartsOn],
  );
  /**
   * One label per column that contains a 1st **of the shown year**, naming that month.
   *
   * Restricted to the year because the grid is padded to whole weeks and its last column
   * can therefore contain January 1st of the next year — which labelled a thirteenth
   * month. A week cannot contain two 1sts, so this yields at most twelve labels.
   */
  const monthLabels = useMemo(
    () =>
      weeks.map((week) => {
        const first = week.find(
          (day) => day.getDate() === 1 && day.getFullYear() === year,
        );
        return first ? monthName(first.getMonth(), locale, "short") : "";
      }),
    [weeks, year, locale],
  );

  return (
    <Box sx={{ overflowX: "auto", pb: 0.5 }}>
      <Box sx={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
        {/* Month row. Same column geometry as the grid below — `YEAR_DAY` wide with a
            `YEAR_GAP` gap — so each name sits over its own column. Matching the grid's
            column *pitch* rather than only its start is what stops the labels drifting
            further right with each month. */}
        <Box
          sx={{
            display: "flex",
            gap: `${YEAR_GAP}px`,
            pl: `${WEEKDAY_GUTTER + 4}px`,
          }}
        >
          {monthLabels.map((label, index) => (
            <Box
              key={index}
              sx={{
                width: YEAR_DAY,
                fontSize: 10,
                color: "text.secondary",
                overflow: "visible",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </Box>
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: "4px" }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateRows: `repeat(7, ${YEAR_DAY}px)`,
              rowGap: `${YEAR_GAP}px`,
              width: WEEKDAY_GUTTER,
              alignItems: "center",
            }}
          >
            {weekdayNames(weekStartsOn, locale, "narrow").map((name, index) => (
              <Typography
                key={index}
                sx={{
                  fontSize: 9,
                  lineHeight: `${YEAR_DAY}px`,
                  color: "text.secondary",
                }}
              >
                {index % 2 === 1 ? name : ""}
              </Typography>
            ))}
          </Box>
          <Box sx={{ display: "flex", gap: `${YEAR_GAP}px` }}>
            {weeks.map((week, weekIndex) => (
              <Box
                key={weekIndex}
                sx={{
                  display: "grid",
                  gridTemplateRows: `repeat(7, ${YEAR_DAY}px)`,
                  rowGap: `${YEAR_GAP}px`,
                }}
              >
                {week.map((day) => {
                  const key = dayKeyFromDate(day);
                  const inYear = day.getFullYear() === year;
                  const ticked = inYear && days.has(key);
                  const isToday = key === todayKey;
                  // Future days stay blank rather than "not done": otherwise an unfilled
                  // November reads as a habit already abandoned in October.
                  const isFuture = key > todayKey;
                  return (
                    <Box
                      key={key}
                      title={
                        inYear
                          ? `${key}${ticked ? " · " + option.name : ""}`
                          : undefined
                      }
                      sx={{
                        width: YEAR_DAY,
                        height: YEAR_DAY,
                        borderRadius: "2px",
                        boxSizing: "border-box",
                        // Out-of-year padding cells (a leading/trailing partial week) are
                        // drawn as nothing, so the year does not appear wider than it is.
                        visibility: inYear ? "visible" : "hidden",
                        backgroundColor: ticked
                          ? onFill
                          : isFuture
                            ? "transparent"
                            : "action.hover",
                        outline: isToday ? "1.5px solid" : "none",
                        outlineColor: isToday ? "primary.main" : undefined,
                        outlineOffset: "1px",
                      }}
                    />
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

/** Width reserved for the weekday letters beside the grid. */
const WEEKDAY_GUTTER = 14;

/**
 * The popover opened by a streak chip: one habit's year, with its run figures.
 *
 * A Popover rather than a Dialog, matching the view-settings panels: this is a look at
 * data, not a confirmation, and anchoring it to the chip keeps the association with the
 * habit that was clicked. The three figures in the header are the same three a user
 * would otherwise have to count by eye.
 */
const OptionYearPopover: React.FC<{
  rows: readonly RowData[];
  calendarProperty: PropertyDef | undefined;
  checklistProperty: PropertyDef | undefined;
  option: OptionDef;
  anchor: HTMLElement;
  onClose: () => void;
}> = ({
  rows,
  calendarProperty,
  checklistProperty,
  option,
  anchor,
  onClose,
}) => {
  const year = new Date().getFullYear();
  const data = useMemo(
    () =>
      calendarProperty && checklistProperty
        ? computeOptionYear(
            rows,
            calendarProperty.id,
            checklistProperty.id,
            option.id,
            year,
            new Date(),
          )
        : null,
    [rows, calendarProperty, checklistProperty, option.id, year],
  );

  if (!data) return null;

  const stats: Array<[string, number]> = [
    [i18n("db_journal_streak_current"), data.current],
    [i18n("db_journal_streak_best"), data.best],
    [i18n("db_journal_streak_year_total"), data.total],
  ];

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{ paper: { sx: { p: 2, maxWidth: "92vw" } } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "3px",
            backgroundColor: optionColorHex(option.color),
            flexShrink: 0,
          }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {option.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {year}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", gap: 2.5, mb: 1.5 }}>
        {stats.map(([label, value]) => (
          <Box key={label}>
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
            >
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </Box>
        ))}
      </Box>

      <OptionYearHeatmap
        option={option}
        year={year}
        days={data.days}
        weekStartsOn={WEEK_STARTS_ON}
      />
    </Popover>
  );
};

interface GridProps {
  anchor: Date;
  weekStartsOn: number;
  bucketFor: (day: Date) => DayBucket;
  binding: DatabaseBinding;
  titleProperty: PropertyDef | undefined;
  detailProperties: PropertyDef[];
  checklistProperty: PropertyDef | undefined;
  onOpenDay: (day: Date) => void;
  detailLimit: number;
  /** Narrow viewport: cells shrink to an indicator, or the grid becomes a list. */
  compact?: boolean;
}

/** The header showing a day's number, the hidden-record warning and the ring. */
const DayHeader: React.FC<{
  day: Date;
  isToday: boolean;
  bucket: DayBucket;
  checklistProperty: PropertyDef | undefined;
}> = ({ day, isToday, bucket, checklistProperty }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
    <Typography
      variant="caption"
      sx={{
        fontWeight: isToday ? 700 : 500,
        color: isToday ? "primary.main" : "text.secondary",
      }}
    >
      {day.getDate()}
    </Typography>
    {bucket.hidden > 0 ? (
      <Tooltip
        title={Format(i18n("db_journal_more_records"), {
          count: bucket.hidden,
        })}
      >
        <WarningAmberRoundedIcon sx={{ fontSize: 13, color: "warning.main" }} />
      </Tooltip>
    ) : null}
    <Box sx={{ flex: 1 }} />
    {checklistProperty && bucket.primary ? (
      <CompletionRing
        done={checkedCount(bucket.primary, checklistProperty.id)}
        total={checklistProperty.options.length}
      />
    ) : null}
  </Box>
);

// ------------------------------------------------------------------ month

const MonthGrid: React.FC<GridProps> = ({
  anchor,
  weekStartsOn,
  bucketFor,
  binding,
  titleProperty,
  detailProperties,
  checklistProperty,
  onOpenDay,
  detailLimit,
  compact,
}) => {
  const locale = useLocale();
  const days = monthGridDays(
    anchor.getFullYear(),
    anchor.getMonth(),
    weekStartsOn,
  );
  const weekdays = weekdayNames(weekStartsOn, locale, "short");
  const weekdaysNarrow = weekdayNames(weekStartsOn, locale, "narrow");
  const today = new Date();

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: 0.5,
      }}
    >
      {(compact ? weekdaysNarrow : weekdays).map((label, index) => (
        <Typography
          key={`${label}-${index}`}
          variant="caption"
          color="text.secondary"
          sx={{ textAlign: "center", fontWeight: 600, py: 0.25 }}
        >
          {label}
        </Typography>
      ))}
      {days.map((day) => {
        const bucket = bucketFor(day);
        const primary = bucket.primary;
        const inPeriod = isSameMonth(day, anchor);
        const isToday = isSameDay(day, today);

        if (compact) {
          // At ~48px wide there is no room for a value. The cell shows the day, a
          // dot meaning "something is here", and the ring when a checklist is set;
          // the contents are one tap away. Showing a truncated word instead would be
          // strictly less informative and harder to read.
          const total = checklistProperty?.options.length ?? 0;
          const done =
            checklistProperty && primary
              ? checkedCount(primary, checklistProperty.id)
              : 0;

          return (
            <Box
              key={dayKeyFromDate(day)}
              onClick={() => onOpenDay(day)}
              sx={{
                position: "relative",
                minHeight: 58,
                p: 0.5,
                borderRadius: 1.5,
                border: "1px solid",
                borderColor: isToday ? "primary.main" : "divider",
                backgroundColor: primary ? "action.hover" : "background.paper",
                opacity: inPeriod ? 1 : 0.4,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.25,
                "&:hover": { backgroundColor: "action.selected" },
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? "primary.main" : "text.secondary",
                  lineHeight: 1.4,
                }}
              >
                {day.getDate()}
              </Typography>

              {checklistProperty && primary ? (
                <CompletionRing
                  done={done}
                  total={total}
                  compact
                  showLabel={false}
                />
              ) : primary ? (
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "primary.main",
                  }}
                />
              ) : null}

              {bucket.hidden > 0 ? (
                <Tooltip
                  title={Format(i18n("db_journal_more_records"), {
                    count: bucket.hidden,
                  })}
                >
                  <WarningAmberRoundedIcon
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      fontSize: 11,
                      color: "warning.main",
                    }}
                  />
                </Tooltip>
              ) : null}
            </Box>
          );
        }

        return (
          <Box
            key={dayKeyFromDate(day)}
            onClick={() => onOpenDay(day)}
            sx={{
              minHeight: 112,
              p: 0.75,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: isToday ? "primary.main" : "divider",
              // Today is tinted rather than merely outlined: a one-pixel border was
              // the only cue, and it is the first thing the eye looks for in a
              // month grid.
              backgroundColor: isToday ? "action.selected" : "background.paper",
              // Neighbouring-month days are dimmed, not dropped: the grid stays a
              // rectangle and a record on the 1st is still reachable.
              opacity: inPeriod ? 1 : 0.4,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 0.25,
              overflow: "hidden",
              transition: "background-color 0.15s, border-color 0.15s",
              "&:hover": { backgroundColor: "action.selected" },
              "&:hover .day-add": { opacity: 1 },
            }}
          >
            <DayHeader
              day={day}
              isToday={isToday}
              bucket={bucket}
              checklistProperty={checklistProperty}
            />

            {primary
              ? (() => {
                  const details = cardDetailProperties(
                    binding,
                    primary,
                    detailProperties,
                    detailLimit,
                  );
                  const title = cardTitleLine(
                    binding,
                    primary,
                    titleProperty,
                    details.length > 0,
                  );
                  return (
                    <>
                      {title ? (
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 500,
                            lineHeight: 1.3,
                            color: details.length
                              ? "text.primary"
                              : "text.disabled",
                            // Indented to line up with the detail lines' icons below it,
                            // so the cell reads as one block rather than a title with a
                            // hanging list.
                            px: 0.25,
                          }}
                          noWrap
                        >
                          {title}
                        </Typography>
                      ) : null}
                      {details.map((property) => (
                        <CardDetailLine
                          key={property.id}
                          property={property}
                          value={primary.values[property.id]}
                          binding={binding}
                          row={primary}
                        />
                      ))}
                    </>
                  );
                })()
              : null}

            {!primary ? (
              <Box
                className="day-add"
                sx={{
                  opacity: 0,
                  mt: "auto",
                  display: "flex",
                  justifyContent: "center",
                  color: "text.disabled",
                  transition: "opacity 0.15s",
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 16 }} />
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};

// ------------------------------------------------------------------- week

const WeekStrip: React.FC<GridProps> = ({
  anchor,
  weekStartsOn,
  bucketFor,
  binding,
  titleProperty,
  detailProperties,
  checklistProperty,
  onOpenDay,
  detailLimit,
  compact,
}) => {
  const locale = useLocale();
  const days = weekDays(anchor, weekStartsOn);
  const weekdays = weekdayNames(weekStartsOn, locale, "short");
  const today = new Date();

  // A phone gets seven full-width **rows**, not seven 47px columns.
  //
  // The 7-column grid is right when each column can hold a record; at phone width it
  // cannot, so the same information is laid out along the axis that actually has
  // room. This is the same content, one cell per row — the calendar is still the
  // subject, it is just rotated.
  if (compact) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {days.map((day, index) => {
          const bucket = bucketFor(day);
          const primary = bucket.primary;
          const isToday = isSameDay(day, today);
          const details = primary
            ? cardDetailProperties(
                binding,
                primary,
                detailProperties,
                detailLimit,
              )
            : [];

          return (
            <Box
              key={dayKeyFromDate(day)}
              onClick={() => onOpenDay(day)}
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
                p: 1,
                borderRadius: 1.5,
                border: "1px solid",
                borderColor: isToday ? "primary.main" : "divider",
                backgroundColor: isToday
                  ? "action.selected"
                  : "background.paper",
                cursor: "pointer",
                transition: "background-color 0.15s",
                "&:hover": { backgroundColor: "action.selected" },
                "&:hover .day-add": { opacity: 1 },
              }}
            >
              {/* A fixed-width date gutter, so the seven rows align in a column and
                  the eye can scan down the dates. */}
              <Box
                sx={{
                  width: 38,
                  flexShrink: 0,
                  textAlign: "center",
                  pt: 0.25,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: "block", fontWeight: 600, lineHeight: 1.2 }}
                >
                  {weekdays[index]}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: isToday ? 700 : 500,
                    lineHeight: 1.1,
                    color: isToday ? "primary.main" : "text.primary",
                  }}
                >
                  {day.getDate()}
                </Typography>
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                {primary ? (
                  <>
                    {(() => {
                      const title = cardTitleLine(
                        binding,
                        primary,
                        titleProperty,
                        details.length > 0,
                      );
                      return title ? (
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, lineHeight: 1.3 }}
                        >
                          {title}
                        </Typography>
                      ) : null;
                    })()}
                    {details.map((property) => (
                      <CardDetailLine
                        key={property.id}
                        property={property}
                        value={primary.values[property.id]}
                        binding={binding}
                        row={primary}
                      />
                    ))}
                  </>
                ) : (
                  <Typography
                    className="day-add"
                    variant="caption"
                    noWrap
                    sx={{
                      opacity: 0.6,
                      color: "text.disabled",
                      transition: "opacity 0.15s",
                      lineHeight: 1.8,
                    }}
                  >
                    {i18n("db_journal_add_record")}
                  </Typography>
                )}
              </Box>

              <Box
                sx={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  pt: 0.25,
                }}
              >
                {bucket.hidden > 0 ? (
                  <Tooltip
                    title={Format(i18n("db_journal_more_records"), {
                      count: bucket.hidden,
                    })}
                  >
                    <WarningAmberRoundedIcon
                      sx={{ fontSize: 15, color: "warning.main" }}
                    />
                  </Tooltip>
                ) : null}
                {checklistProperty && primary ? (
                  <CompletionRing
                    done={checkedCount(primary, checklistProperty.id)}
                    total={checklistProperty.options.length}
                    showLabel={false}
                  />
                ) : null}
                {!primary ? (
                  <AddRoundedIcon
                    className="day-add"
                    sx={{
                      fontSize: 18,
                      color: "text.disabled",
                      transition: "opacity 0.15s",
                    }}
                  />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: 0.5,
      }}
    >
      {days.map((day, index) => {
        const bucket = bucketFor(day);
        const primary = bucket.primary;
        const isToday = isSameDay(day, today);
        return (
          <Box
            key={dayKeyFromDate(day)}
            onClick={() => onOpenDay(day)}
            sx={{
              minHeight: 320,
              p: 0.75,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: isToday ? "primary.main" : "divider",
              backgroundColor: isToday ? "action.selected" : "background.paper",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              overflow: "hidden",
              transition: "background-color 0.15s",
              "&:hover": { backgroundColor: "action.selected" },
              "&:hover .day-add": { opacity: 1 },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {weekdays[index]}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {bucket.hidden > 0 ? (
                <Tooltip
                  title={Format(i18n("db_journal_more_records"), {
                    count: bucket.hidden,
                  })}
                >
                  <WarningAmberRoundedIcon
                    sx={{ fontSize: 14, color: "warning.main" }}
                  />
                </Tooltip>
              ) : null}
              {checklistProperty && primary ? (
                <CompletionRing
                  done={checkedCount(primary, checklistProperty.id)}
                  total={checklistProperty.options.length}
                />
              ) : null}
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? "primary.main" : "text.primary",
                }}
              >
                {day.getDate()}
              </Typography>
            </Box>

            {primary ? (
              <Box
                sx={{
                  p: 0.75,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  backgroundColor: "background.paper",
                }}
              >
                {(() => {
                  const details = cardDetailProperties(
                    binding,
                    primary,
                    detailProperties,
                    detailLimit,
                  );
                  const title = cardTitleLine(
                    binding,
                    primary,
                    titleProperty,
                    details.length > 0,
                  );
                  return (
                    <>
                      {title ? (
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, lineHeight: 1.3 }}
                        >
                          {title}
                        </Typography>
                      ) : null}
                      {details.map((property) => (
                        <CardDetailLine
                          key={property.id}
                          property={property}
                          value={primary.values[property.id]}
                          binding={binding}
                          row={primary}
                        />
                      ))}
                    </>
                  );
                })()}
              </Box>
            ) : (
              <Box
                className="day-add"
                sx={{
                  opacity: 0,
                  mt: "auto",
                  display: "flex",
                  justifyContent: "center",
                  color: "text.disabled",
                  transition: "opacity 0.15s",
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 18 }} />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

// ------------------------------------------------------------------- year

/**
 * Twelve mini month grids, as a **density** view.
 *
 * No field text and no per-cell content: 365 labelled cells is neither readable nor
 * fast. Each day is a square reporting whether something is recorded and, with a
 * checklist configured, how complete it was. Clicking a day opens its record; the
 * week and month scales are where the contents are read.
 */
const YearGrid: React.FC<{
  anchor: Date;
  bucketFor: (day: Date) => DayBucket;
  checklistProperty: PropertyDef | undefined;
  onOpenDay: (day: Date) => void;
  /**
   * The week-start the whole view uses, taken from the parent rather than assumed.
   *
   * The year grid previously hardcoded Monday, which put its twelve mini-calendars
   * one column out of step with the month view in English — the same data drawn two
   * different ways. It is a prop now so the three scales cannot drift again.
   */
  weekStartsOn: number;
}> = ({ anchor, bucketFor, checklistProperty, onOpenDay, weekStartsOn }) => {
  const locale = useLocale();
  const today = new Date();

  return (
    <Box
      sx={{
        display: "grid",
        // Fixed cell sizes, not a proportional grid: this is a density display, so
        // the squares must stay small however wide the window is. `aspectRatio` of
        // a flexible column turns twelve mini-calendars into a full-page scroll.
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: 1.5,
      }}
    >
      {Array.from({ length: 12 }, (_, month) => {
        const days = monthGridDays(anchor.getFullYear(), month, weekStartsOn);
        const inMonth = days.filter((day) => day.getMonth() === month);
        const recorded = inMonth.filter((day) => bucketFor(day).primary).length;

        return (
          <Box key={month}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 0.5,
                mb: 0.75,
                px: 0.25,
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.01em" }}
              >
                {monthName(month, locale, "short")}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontSize: 10,
                  color: recorded > 0 ? "text.secondary" : "text.disabled",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {recorded}
              </Typography>
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: `repeat(7, ${YEAR_CELL}px)`,
                gap: `${YEAR_CELL_GAP}px`,
              }}
            >
              {days.map((day) => {
                const belongs = day.getMonth() === month;
                const bucket = belongs ? bucketFor(day) : EMPTY_BUCKET;
                const hasRecord = bucket.primary !== null;
                const total = checklistProperty?.options.length ?? 0;
                const done =
                  checklistProperty && bucket.primary
                    ? checkedCount(bucket.primary, checklistProperty.id)
                    : 0;
                const isToday = isSameDay(day, today);

                return (
                  <Tooltip
                    key={dayKeyFromDate(day)}
                    title={dayKeyFromDate(day)}
                    disableInteractive
                  >
                    <Box
                      onClick={() => belongs && onOpenDay(day)}
                      sx={{
                        width: YEAR_CELL,
                        height: YEAR_CELL,
                        borderRadius: "3px",
                        cursor: belongs ? "pointer" : "default",
                        // Laid out but invisible, so the 7-column alignment holds.
                        visibility: belongs ? "visible" : "hidden",
                        backgroundColor: yearCellColor(hasRecord, total, done),
                        outline: isToday ? "1px solid" : "none",
                        outlineColor: "primary.main",
                        outlineOffset: "1px",
                        "&:hover": belongs
                          ? {
                              outline: "1px solid",
                              outlineColor: "text.primary",
                            }
                          : undefined,
                      }}
                    />
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

/** Year-grid cell edge, and the gap between cells. */
const YEAR_CELL = 16;
const YEAR_CELL_GAP = 3;

/**
 * A year-grid square's fill: recorded or not, then a completion ramp.
 *
 * Colour carries the meaning, so the states are made distinguishable without a
 * legend: nothing (faint grey), recorded but nothing ticked, partly done (amber),
 * and complete (green).
 */
function yearCellColor(
  hasRecord: boolean,
  total: number,
  done: number,
): string {
  // Without a checklist a day is binary: recorded or not.
  if (total <= 0) return hasRecord ? "primary.main" : "action.hover";
  if (done <= 0) return hasRecord ? "action.selected" : "action.hover";
  return done >= total ? "success.main" : "warning.main";
}
