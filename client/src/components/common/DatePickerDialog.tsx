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
      const dateObj = new Date(initDate);
      const dateStr = dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = dateObj.toTimeString().slice(0, 5); // HH:MM
      setDate(dateStr);
      setTime(timeStr);
    } else if (open) {
      // Default to today
      const now = new Date();
      setDate(now.toISOString().slice(0, 10));
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
    
    try {
      const timestamp = time 
        ? new Date(`${date}T${time}`).getTime()
        : new Date(`${date}T23:59`).getTime();
      
      if (!isNaN(timestamp)) {
        onConfirm(timestamp);
      }
    } catch (e) {
      console.error("Invalid date:", e);
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
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
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
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
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
          <Box sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
            {date && (
              <Typography variant="body2">
                {i18n("deadline_preview")} {new Date(time ? `${date}T${time}` : `${date}T23:59`).toLocaleString()}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{i18n("cancel_button")}</Button>
        <Button onClick={handleClear} color="error">
          {i18n("deadline_clear_button")}
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!date}
        >
          {buttonText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
