import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import React from "react";
import { i18n } from "../../internationnalization/utils";

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  content: string;
  buttonText: string;
  onConfirm: () => void;
  onClose?: () => void;
}> = (props) => {
  const { open, title, content, buttonText, onConfirm, onClose } = props;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{content}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{i18n("cancel_button")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm();
          }}
        >
          {buttonText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
