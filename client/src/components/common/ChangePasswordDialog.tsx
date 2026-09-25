import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHttpRequest } from "../../hooks/hooks";
import { i18n } from "../../internationnalization/utils";
import Format from "string-format";
import { GlobalSnackBar } from "./GlobalSnackBar";
import { LoadingButton } from "./LoadingButton";
import { gotoLogin } from "../../utils/gotoLogin";

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

const minPasswordLength = 6;
const maxPasswordLength = 127;

export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  onClose,
}) => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useHttpRequest();
  const navigate = useNavigate();

  const reset = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleClose = () => {
    if (loading) {
      return;
    }
    reset();
    onClose();
  };

  const changePassword = useCallback(async () => {
    const sendError = (message: string) => {
      GlobalSnackBar.getInstance().pushMessage(message, "error");
    };

    if (
      oldPassword.length < minPasswordLength ||
      oldPassword.length > maxPasswordLength ||
      newPassword.length < minPasswordLength ||
      newPassword.length > maxPasswordLength
    ) {
      sendError(i18n("password_length_invalid"));
      return;
    }

    if (newPassword !== confirmPassword) {
      sendError(i18n("password_not_correct"));
      return;
    }

    if (newPassword === oldPassword) {
      sendError(i18n("new_password_same_as_old"));
      return;
    }

    setLoading(true);
    const result = await request("changePassword", {
      oldPassword,
      newPassword,
    });
    setLoading(false);

    if (result?.success) {
      GlobalSnackBar.getInstance().pushMessage(
        i18n("success_change_password"),
        "success",
      );
      reset();
      onClose();
      // The stored token is no longer in sync with the new password, so
      // sign the user out and ask them to sign in again.
      gotoLogin(navigate);
    } else {
      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("failed_to_change_password"), {
          errorMessage: result?.errorMessage ?? "",
        }),
        "error",
      );
    }
  }, [oldPassword, newPassword, confirmPassword, request, navigate]);

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{i18n("change_password")}</DialogTitle>
      <DialogContent>
        <Box component="form" autoComplete="off">
          <Stack spacing="18px" marginTop={(t) => t.spacing()}>
            <TextField
              type="password"
              fullWidth
              required
              label={i18n("old_password")}
              value={oldPassword}
              autoComplete="new-password"
              onChange={(e) => {
                setOldPassword(e.target.value);
              }}
            />
            <TextField
              type="password"
              fullWidth
              required
              label={i18n("new_password")}
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
            />
            <TextField
              type="password"
              fullWidth
              required
              label={i18n("confirm_password")}
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(e) => {
                setConfirmPassword(e.target.value);
              }}
            />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="secondary" disabled={loading}>
          {i18n("cancel_button")}
        </Button>
        <LoadingButton
          loading={loading}
          variant="contained"
          onClick={() => {
            changePassword();
          }}
        >
          {i18n("confirm_button")}
        </LoadingButton>
      </DialogActions>
    </Dialog>
  );
};
