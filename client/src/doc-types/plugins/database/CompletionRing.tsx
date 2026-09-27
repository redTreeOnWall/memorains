import React from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { completionRatio } from "./journalDays";

/**
 * Per-day completion ring for a journal view's checklist column.
 *
 * ## The denominator is the whole option list
 *
 * Removing an option retroactively raises every past day's completion, and adding
 * one lowers it. That is what it means for the option list to be user-editable data,
 * and it is accepted rather than worked around: per-option effective dates were
 * considered and rejected as disproportionate.
 *
 * Two consequences are therefore made visible instead of hidden:
 *
 * - the numeric `done/total` is always rendered, so the denominator is never
 *   invisible; and
 * - zero options renders **nothing at all** — `0/0` is a bug, not "incomplete".
 */

/** Ring diameter for a month cell. */
const SIZE = 26;
const STROKE = 3;

/** Colour ramp: empty → partial → complete. */
function ringColor(ratio: number): string {
  if (ratio >= 1) return "#2e7d32";
  if (ratio >= 0.66) return "#558b2f";
  if (ratio >= 0.33) return "#f9a825";
  if (ratio > 0) return "#ef6c00";
  return "#bdbdbd";
}

export const CompletionRing: React.FC<{
  done: number;
  total: number;
  /** Hide the numeric label where there is no room (the year grid). */
  showLabel?: boolean;
  /** Render at a smaller size, for the year grid. */
  compact?: boolean;
}> = ({ done, total, showLabel = true, compact = false }) => {
  const ratio = completionRatio(done, total);
  // No options means nothing to measure; a ring would read as a score of zero.
  if (ratio === null) return null;

  const size = compact ? 16 : SIZE;
  const stroke = compact ? 2 : STROKE;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * ratio;
  const color = ringColor(ratio);

  return (
    <Tooltip title={Format(i18n("db_journal_day_progress"), { done, total })}>
      <Box
        sx={{
          position: "relative",
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label={Format(i18n("db_journal_day_progress"), { done, total })}
      >
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            opacity={0.18}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circumference - filled}`}
            strokeLinecap={ratio > 0 && ratio < 1 ? "round" : "butt"}
          />
        </svg>
        {showLabel && !compact ? (
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              fontSize: 9,
              lineHeight: 1,
              fontWeight: 600,
              color: "text.secondary",
            }}
          >
            {done}/{total}
          </Typography>
        ) : null}
      </Box>
    </Tooltip>
  );
};
