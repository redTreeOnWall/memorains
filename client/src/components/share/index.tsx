import React, { useEffect, useState } from "react";
import { useHttpRequest } from "../../hooks/hooks";
import { C2S_ShareDocMessage, S2C_DocInfo } from "../../interface/HttpMessage";
import { PrivilegeEnum } from "../../interface/DataEntity";
import { GlobalSnackBar } from "../common/GlobalSnackBar";
import { LoadingButton } from "../common/LoadingButton";
import { awaitTime } from "../../utils/utils";
import {
  DialogContent,
  TextField,
  DialogActions,
  Button,
  Dialog,
  DialogTitle,
  Box,
  Switch,
  FormControlLabel,
  FormGroup,
} from "@mui/material";
import { i18n } from "../../internationnalization/utils";

interface ShareProps {
  docId: string;
}

export const ShareWindow: React.FC<{
  open: boolean;
  docInfo: S2C_DocInfo | null;
  onConfirm: (value: string) => void;
  onClose?: () => void;
}> = (props) => {
  const { open, onConfirm, onClose, docInfo } = props;
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{i18n("share_panel_title")}</DialogTitle>
      <DialogContent>
        <Box>
          <FormGroup>
            <FormControlLabel
              control={<Switch checked={!!docInfo?.data?.doc.is_public} />}
              label="Public Document"
            />
          </FormGroup>
        </Box>
        <TextField
          autoFocus
          fullWidth
          label="User ID:"
          margin="dense"
          value={text}
          variant="standard"
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
          Share
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const Share: React.FC<ShareProps> = ({ docId }) => {
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docInfo, setDocInfo] = useState<S2C_DocInfo | null>(null);
  const request = useHttpRequest();

  useEffect(() => {
    setShowDialog(false);
    setLoading(false);
  }, [docId]);

  const shareDoc = async (userShareTo: string, privilege: PrivilegeEnum) => {
    setLoading(true);
    await awaitTime(500);
    const shareMes: C2S_ShareDocMessage = {
      docID: docId,
      userName: userShareTo,
      privilege,
    };
    const response = await request("shareDoc", shareMes);

    if (response?.success) {
      GlobalSnackBar.getInstance().pushMessage(
        `The document shared!`,
        "success",
      );
    } else {
      GlobalSnackBar.getInstance().pushMessage(
        response?.errorMessage ?? `Failed to share the document!`,
        "error",
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (showDialog && docId) {
      const requestDocInfo = async () => {
        setLoading(true);
        await awaitTime(500);
        const res = await request("docInfo", {
          docID: docId,
          needState: false,
        });
        if (res) {
          setDocInfo(res);
        }
        setLoading(false);
      };

      requestDocInfo();
    }
  }, [showDialog, request, docId]);

  return (
    <>
      <LoadingButton
        loading={loading}
        variant="contained"
        size="small"
        onClick={() => {
          setShowDialog(true);
        }}
      >
        {i18n("share_button")}
      </LoadingButton>
      <ShareWindow
        open={!loading && showDialog}
        docInfo={docInfo}
        onConfirm={(userId) => {
          if (userId) {
            shareDoc(userId, PrivilegeEnum.editor);
          }
          setShowDialog(false);
        }}
        onClose={() => {
          setShowDialog(false);
        }}
      />
    </>
  );
};
