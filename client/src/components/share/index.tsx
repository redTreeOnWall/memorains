import React, { useEffect, useState } from "react";
import { useHttpRequest } from "../../hooks/hooks";
import { C2S_ShareDocMessage, S2C_DocInfo } from "../../interface/HttpMessage";
import {
  DocType,
  DocumentPublic,
  PrivilegeEnum,
} from "../../interface/DataEntity";
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
  Tabs,
  Tab,
  Link,
} from "@mui/material";
import { i18n } from "../../internationnalization/utils";
import { Space } from "../common/Space";

interface ShareProps {
  docId: string;
}

export const ShareWindow: React.FC<{
  open: boolean;
  docInfo: S2C_DocInfo | null;
  onConfirm: (value: { userId?: string; isPublic?: DocumentPublic }) => void;
  onClose?: () => void;
}> = (props) => {
  const { open, onConfirm, onClose, docInfo } = props;
  const isPublic = !!docInfo?.data?.doc.is_public;
  const [shareToPublic, setShareToPublic] = useState(true);
  const [userId, setUserId] = useState("");
  const [isPublicState, setIsPublicState] = useState(isPublic);

  useEffect(() => {
    setUserId("");
    setIsPublicState(isPublic);
    setShareToPublic(true);
  }, [open, isPublic]);

  const docId = docInfo?.data?.doc.id;
  // TODO read from injected config or dynamically read from remote
  const docType =
    docInfo?.data?.doc.doc_type === DocType.canvas ? "canvas" : "document";
  const shareToPublicLink = docId
    ? `${location.origin}/doc/client/${docType}?docId=${docId}&viewMode=true`
    : "";

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{i18n("share_panel_title")}</DialogTitle>
      <DialogContent>
        <Box sx={{ width: "100%" }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs
              value={shareToPublic ? 0 : 1}
              onChange={(_, value: number) => {
                setShareToPublic(value === 0);
              }}
            >
              <Tab label={i18n("share_public")} />
              <Tab label={i18n("share_user")} />
            </Tabs>
          </Box>
        </Box>
        <Space />
        {shareToPublic && (
          <Box>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={isPublicState}
                    onChange={(_, checked) => {
                      setIsPublicState(checked);
                    }}
                  />
                }
                label={i18n("share_public")}
              />
            </FormGroup>
            {isPublicState && (
              <Box>
                <Box> {i18n("share_public_link_description")} </Box>
                <Link href={shareToPublicLink}>{shareToPublicLink}</Link>
              </Box>
            )}
          </Box>
        )}
        {!shareToPublic && (
          <TextField
            autoFocus
            fullWidth
            label="User ID:"
            margin="dense"
            value={userId}
            variant="standard"
            onChange={(e) => {
              setUserId(e.target.value);
            }}
            onFocus={(e) => {
              e.target.setSelectionRange(0, e.target.value.length);
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{i18n("cancel_button")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm(
              shareToPublic
                ? {
                    isPublic: isPublicState
                      ? DocumentPublic.publicView
                      : DocumentPublic.private,
                  }
                : { userId },
            );
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

  const shareDocToUser = async (
    isPublic?: DocumentPublic,
    userShareTo?: string,
    privilege?: PrivilegeEnum,
  ) => {
    setLoading(true);
    await awaitTime(500);
    const shareMes: C2S_ShareDocMessage = {
      docID: docId,
      userName: userShareTo,
      privilege,
      isPublic,
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
        onConfirm={({ userId, isPublic }) => {
          shareDocToUser(isPublic, userId, PrivilegeEnum.editor);
          setShowDialog(false);
        }}
        onClose={() => {
          setShowDialog(false);
        }}
      />
    </>
  );
};
