import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import React from "react";
import { i18n } from "../../internationnalization/utils";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onClose?: () => void;
  confirmColor?: "inherit" | "primary" | "secondary" | "success" | "error" | "info" | "warning";
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = (props) => {
  const {
    open,
    title,
    content,
    confirmText = i18n("confirm_button"),
    cancelText = i18n("cancel_button"),
    onConfirm,
    onClose,
    confirmColor = "primary"
  } = props;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-dialog-description">
          {content}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary">
          {cancelText}
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          onClick={() => {
            onConfirm();
          }}
          autoFocus
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
