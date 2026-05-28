import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Popover,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Checkbox,
  IconButton,
  Tooltip,
} from "@mui/material";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import { i18n } from "../../internationnalization/utils";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  deadline?: number;
}

interface TodoHeatmapProps {
  todos: TodoItem[];
  theme: string;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}

const CELL_SIZE = 13;
const CELL_GAP = 3;
const WEEKDAYS_SHORT = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDeadlineColor(deadline: number, isDark: boolean): string {
  const now = Date.now();
  const diff = deadline - now;
  if (diff < 0) return "#f44336";
  if (diff < 86400000) return "#ff9800";
  if (diff < 604800000) return "#2196f3";
  return isDark ? "#ddd" : "#666";
}

function formatDeadline(timestamp: number): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMs < 0) {
    const overdueHours = Math.floor(-diffMs / 3600000);
    if (overdueHours < 24) {
      return (i18n("overdue_by_hours") as string).replace(
        "{hours}",
        overdueHours.toString(),
      );
    }
    return (i18n("overdue_by_days") as string).replace(
      "{days}",
      Math.floor(overdueHours / 24).toString(),
    );
  } else if (diffHours < 24) {
    return (i18n("due_in_hours") as string).replace(
      "{hours}",
      diffHours.toString(),
    );
  } else {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return (i18n("due_date") as string).replace("{date}", `${y}-${m}-${day}`);
  }
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function cellColor(
  count: number,
  completedCount: number,
  hasOverdue: boolean,
  isDark: boolean,
): string {
  // Only completed items, no active — muted, unobtrusive color
  if (count === 0 && completedCount > 0) {
    return isDark ? "#222a22" : "#d6ded6";
  }
  if (count === 0) return isDark ? "#1e1e1e" : "#ebedf0";
  if (hasOverdue) {
    // Red-ish scale for cells with overdue items
    if (count <= 1) return "#ffcdd2";
    if (count <= 2) return "#ef9a9a";
    if (count <= 4) return "#e57373";
    return "#c62828";
  }
  // Green scale
  if (count <= 1) return "#9be9a8";
  if (count <= 2) return "#40c463";
  if (count <= 4) return "#30a14e";
  return "#216e39";
}

// ── Memoized cell component to skip re-renders when data hasn't changed ──
const HeatmapCell = memo(function HeatmapCell({
  date,
  count,
  completedCount,
  hasOverdue,
  isToday,
  isDark,
  onClick,
}: {
  date: Date;
  count: number;
  completedCount: number;
  hasOverdue: boolean;
  isToday: boolean;
  isDark: boolean;
  onClick: (e: React.MouseEvent<HTMLElement>, date: Date) => void;
}) {
  const color = cellColor(count, completedCount, hasOverdue, isDark);
  const hasAnyTasks = count > 0 || completedCount > 0;
  const tooltipDate = date.toLocaleDateString("default", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const tooltipText = hasAnyTasks
    ? `${tooltipDate}: ${count} active${completedCount > 0 ? `, ${completedCount} done` : ""}`
    : tooltipDate;

  return (
    <Tooltip title={tooltipText} arrow disableInteractive>
      <Box
        onClick={(e) => onClick(e, date)}
        sx={{
          width: CELL_SIZE,
          height: CELL_SIZE,
          borderRadius: "2px",
          backgroundColor: color,
          cursor: "pointer",
          outline: isToday
            ? `1.5px solid ${isDark ? "#58a6ff" : "#0969da"}`
            : "none",
          outlineOffset: 0,
          "&:hover": {
            outline: isToday
              ? `2px solid ${isDark ? "#79c0ff" : "#0969da"}`
              : `1.5px solid ${isDark ? "#555" : "#999"}`,
          },
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
});

// ── Main component ──
export const TodoHeatmap: React.FC<TodoHeatmapProps> = ({
  todos,
  theme,
  onToggle,
  onDelete,
}) => {
  const isDark = theme === "dark";
  const textColor = isDark ? "#8b949e" : "#57606a";

  // Stable today reference — only changes at midnight
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // 6 past months + 6 future months ≈ 52 weeks
  const totalWeeks = 53;
  const pastWeeks = 26;
  const startDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - pastWeeks * 7);
    d.setDate(d.getDate() - d.getDay()); // align to Sunday
    return d;
  }, [today]);

  // Memoized date → tasks map
  const tasksByDate = useMemo(() => {
    const map = new Map<
      string,
      { active: TodoItem[]; completed: TodoItem[] }
    >();
    for (const todo of todos) {
      if (!todo.deadline) continue;
      const key = dateKey(new Date(todo.deadline));
      if (!map.has(key)) {
        map.set(key, { active: [], completed: [] });
      }
      const entry = map.get(key)!;
      if (todo.completed) {
        entry.completed.push(todo);
      } else {
        entry.active.push(todo);
      }
    }
    return map;
  }, [todos]);

  // Memoized grid [week][dayOfWeek]
  interface CellData {
    date: Date;
    count: number;
    completedCount: number;
    hasOverdue: boolean;
  }
  const grid = useMemo(() => {
    const now = Date.now();
    const result: CellData[][] = [];
    const cursor = new Date(startDate);
    for (let w = 0; w < totalWeeks; w++) {
      const week: CellData[] = [];
      for (let d = 0; d < 7; d++) {
        const entry = tasksByDate.get(dateKey(cursor));
        const activeCount = entry?.active.length ?? 0;
        const completedCount = entry?.completed.length ?? 0;
        const hasOverdue = entry
          ? entry.active.some((t) => (t.deadline ?? 0) < now)
          : false;
        week.push({
          date: new Date(cursor),
          count: activeCount,
          completedCount,
          hasOverdue,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  }, [tasksByDate, startDate, totalWeeks]);

  // Memoized month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; col: number }[] = [];
    for (let w = 0; w < totalWeeks; w++) {
      const firstDayOfWeek = grid[w][0].date;
      if (firstDayOfWeek.getDate() <= 7) {
        labels.push({
          label: MONTH_NAMES[firstDayOfWeek.getMonth()],
          col: w,
        });
      }
    }
    return labels;
  }, [grid, totalWeeks]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Popover state
  const [popoverDay, setPopoverDay] = useState<Date | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);

  const handleCellClick = (e: React.MouseEvent<HTMLElement>, date: Date) => {
    setPopoverAnchor(e.currentTarget);
    setPopoverDay(date);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setPopoverDay(null);
  };

  // Auto-scroll to center today on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const msPerDay = 86400000;
    const daysFromStart = Math.floor(
      (today.getTime() - startDate.getTime()) / msPerDay,
    );
    const todayCol = Math.floor(daysFromStart / 7);
    // Left offset: day labels (30px) + gap + grid left padding
    const leftOffset = 30 + CELL_GAP + CELL_GAP;
    const colCenter =
      leftOffset + todayCol * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
    const scrollTo = colCenter - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, scrollTo);
  }, []); // only on mount

  const popoverTasks = useMemo(() => {
    if (!popoverDay) return [];
    const entry = tasksByDate.get(dateKey(popoverDay));
    if (!entry) return [];
    return [...entry.active, ...entry.completed];
  }, [popoverDay, tasksByDate]);

  return (
    <Box>
      {/* Legend */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 0.5,
          mb: 0.5,
          pr: 0.5,
        }}
      >
        <Typography variant="caption" sx={{ color: textColor, mr: 0.5 }}>
          Less
        </Typography>
        {[0, 1, 2, 3, 5].map((n) => (
          <Box
            key={n}
            sx={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              borderRadius: "2px",
              backgroundColor: cellColor(n, 0, false, isDark),
            }}
          />
        ))}
        <Typography variant="caption" sx={{ color: textColor, ml: 0.5 }}>
          More
        </Typography>
      </Box>

      {/* Scrollable container */}
      <Box ref={scrollRef} sx={{ overflowX: "auto", pb: 0.5 }}>
        {/* Month labels */}
        <Box
          sx={{
            display: "flex",
            ml: `${30 + CELL_GAP}px`,
            mb: 0.25,
            position: "relative",
            height: 16,
          }}
        >
          {monthLabels.map((ml, i) => (
            <Typography
              key={i}
              variant="caption"
              sx={{
                position: "absolute",
                left: ml.col * (CELL_SIZE + CELL_GAP),
                color: textColor,
                fontSize: "0.65rem",
              }}
            >
              {ml.label}
            </Typography>
          ))}
        </Box>

        <Box sx={{ display: "flex" }}>
          {/* Day-of-week labels */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: `${CELL_GAP}px`,
              mr: 0.5,
              mt: "2px",
            }}
          >
            {WEEKDAYS_SHORT.map((label, i) => (
              <Box
                key={i}
                sx={{
                  width: 30,
                  height: CELL_SIZE,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {label ? (
                  <Typography
                    variant="caption"
                    sx={{
                      color: textColor,
                      fontSize: "0.6rem",
                      lineHeight: 1,
                    }}
                  >
                    {label}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Box>

          {/* Grid */}
          <Box
            sx={{ display: "flex", gap: `${CELL_GAP}px`, pl: `${CELL_GAP}px` }}
          >
            {grid.map((week, wi) => (
              <Box
                key={wi}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: `${CELL_GAP}px`,
                }}
              >
                {week.map((cell, di) => (
                  <HeatmapCell
                    key={di}
                    date={cell.date}
                    count={cell.count}
                    completedCount={cell.completedCount}
                    hasOverdue={cell.hasOverdue}
                    isToday={isSameDay(cell.date, today)}
                    isDark={isDark}
                    onClick={handleCellClick}
                  />
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Popover */}
      <Popover
        open={Boolean(popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={handlePopoverClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: "90vw" } } }}
      >
        <Box sx={{ p: 1 }}>
          <Typography
            variant="subtitle2"
            sx={{ px: 1, py: 0.5, fontWeight: 600 }}
          >
            {popoverDay?.toLocaleDateString("default", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </Typography>
          {popoverTasks.length === 0 ? (
            <Typography
              variant="body2"
              sx={{ px: 1, py: 1, color: "text.secondary" }}
            >
              {i18n("calendar_no_tasks") as string}
            </Typography>
          ) : (
            <List dense disablePadding>
              {popoverTasks.map((task) => (
                <ListItem
                  key={task.id}
                  sx={{ borderRadius: 1, opacity: task.completed ? 0.6 : 1 }}
                  disablePadding
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox
                      size="small"
                      edge="start"
                      checked={task.completed}
                      onChange={() => onToggle(task.id, !task.completed)}
                      icon={<RadioButtonUncheckedIcon fontSize="small" />}
                      checkedIcon={<CheckCircleIcon fontSize="small" />}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={task.text}
                    secondary={
                      task.deadline ? (
                        <Box
                          component="span"
                          sx={{
                            fontSize: "0.7rem",
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <CalendarTodayIcon sx={{ fontSize: 10 }} />
                          <span
                            style={{
                              color: getDeadlineColor(task.deadline, isDark),
                            }}
                          >
                            {formatDeadline(task.deadline)}
                          </span>
                        </Box>
                      ) : undefined
                    }
                    sx={{
                      textDecoration: task.completed ? "line-through" : "none",
                    }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => onDelete(task.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Popover>
    </Box>
  );
};
