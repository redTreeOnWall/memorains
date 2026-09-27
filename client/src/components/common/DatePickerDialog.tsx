import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Stack,
  Box,
  Typography,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import { i18n } from "../../internationnalization/utils";
import {
  localDateString,
  localDateTime,
  localTimeString,
} from "../../utils/localDate";

export interface DatePickerDialogBasicProps {
  title: string;
  buttonText: string;
  initDate?: number; // Unix timestamp
}

export interface DatePickerDialogProps extends DatePickerDialogBasicProps {
  open: boolean;
  onConfirm: (timestamp: number | null) => void;
  onClose?: () => void;
}

export const DatePickerDialog: React.FC<DatePickerDialogProps> = (props) => {
  const { open, title, buttonText, onConfirm, initDate, onClose } = props;

  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (open && initDate) {
      // Both fields are read in **local** time. Reading the day with
      // `toISOString().slice(0, 10)` (UTC) while reading the time with
      // `toTimeString()` (local) mixed two conventions inside one round trip: at
      // UTC+8 a value stored for local 00:00 reopened as the previous day, and
      // confirming it unchanged moved the record back a day. See `localDate.ts`.
      const dateObj = new Date(initDate);
      setDate(localDateString(dateObj));
      setTime(localTimeString(dateObj));
    } else if (open) {
      // Default to today, in local time — `toISOString()` would give yesterday
      // for the first hours of the day anywhere east of Greenwich.
      const now = new Date();
      setDate(localDateString(now));
      setTime("23:59"); // End of day default
    } else {
      setDate("");
      setTime("");
    }
  }, [open, initDate]);

  const handleConfirm = () => {
    if (!date) {
      onConfirm(null); // Remove deadline
      return;
    }

    // Built from local calendar parts rather than string concatenation, so the
    // two fields cannot disagree about which convention they are in.
    const parsed = localDateTime(date, time || "23:59");
    if (parsed) {
      onConfirm(parsed.getTime());
    }
  };

  const handleClear = () => {
    onConfirm(null);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 1, display: "block" }}
            >
              {i18n("deadline_date_label")}
            </Typography>
            <TextField
              fullWidth
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              variant="outlined"
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 1, display: "block" }}
            >
              {i18n("deadline_time_label")}
            </Typography>
            <TextField
              fullWidth
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              variant="outlined"
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }} // 5 minute steps
            />
          </Box>
          <Box sx={{ fontSize: "0.85rem", color: "text.secondary" }}>
            {date &&
              (() => {
                const preview = localDateTime(date, time || "23:59");
                return preview ? (
                  <Typography variant="body2">
                    {i18n("deadline_preview")} {preview.toLocaleString()}
                  </Typography>
                ) : null;
              })()}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{i18n("cancel_button")}</Button>
        <Button onClick={handleClear} color="error">
          {i18n("deadline_clear_button")}
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!date}>
          {buttonText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
