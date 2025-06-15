import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import { i18n } from "../../internationnalization/utils";

export type InputNameDialogBasicProps = {
  title: string;
  label: string;
  buttonText: string;
  initText?: string;
  type?: React.HTMLInputTypeAttribute;
};

export type InputNameDialogProps = InputNameDialogBasicProps & {
  open: boolean;
  onConfirm: (value: string) => void;
  onClose?: () => void;
};

export const InputNameDialog: React.FC<InputNameDialogProps> = (props) => {
  const { open, title, label, buttonText, onConfirm, initText, onClose, type } =
    props;
  const [text, setText] = useState(initText ?? "");
  useEffect(() => {
    if (open) {
      setText(initText ?? "");
    } else {
      setText("");
    }
  }, [open, initText]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label={label}
          margin="dense"
          value={text}
          variant="standard"
          type={type}
          autoComplete="one-time-code"
          onChange={(e) => {
            setText(e.target.value);
          }}
          onFocus={(e) => {
            e.target.setSelectionRange(0, e.target.value.length);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{i18n("cancel_button")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm(text);
          }}
        >
          {buttonText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
