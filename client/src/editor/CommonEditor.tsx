import React from "react";
import * as Y from "yjs";
import { useEffect, useState } from "react";
import { useCheckJwtAndGotoLogin, useHttpRequest } from "../hooks/hooks";
import { getAuthorization } from "../utils/getAuthorization";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Fab,
  ListItemButton,
  Stack,
} from "@mui/material";
import { hashColorWitchCache, toSizeString } from "../utils/utils";
import {
  S2C_DocInfoMessage,
  S2C_UserListMessage,
} from "../interface/UserServerMessage";
import { RefreshRounded } from "@mui/icons-material";
import { Share } from "../components/share";
// import LockRoundedIcon from "@mui/icons-material/LockRounded";
// import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { IClient } from "../interface/Client";
import CloudSyncRoundedIcon from "@mui/icons-material/CloudSyncRounded";
import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SaveAltRoundedIcon from "@mui/icons-material/SaveAltRounded";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";
import { Editor, NoteDocument } from "./NoteDocument";
import { MessageBridge } from "./MessageBridge";
import { Space } from "../components/common/Space";
import { i18n } from "../internationnalization/utils";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { SideList } from "../components/SideList";

export type CoreEditorProps = {
  client: IClient;
  docInstance: NoteDocument | null;
  onBind: () => void;
};

export const CommonEditor: React.FC<{
  client: IClient;
  CoreEditor: React.FC<CoreEditorProps>;
}> = ({ client, CoreEditor }) => {
  client.lastDocHaveBeenOpen = true;
  const offlineMode = client.offlineMode.value;
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [docInfo, setDocInfo] = useState<
    S2C_DocInfoMessage["data"]["docInfo"] | null
  >(null);
  const [userListMessage, setUserListMessage] =
    useState<S2C_UserListMessage | null>(null);

  const [synchronized, setSynchronized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needSave, setNeedSave] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const viewMode = urlParams.get("viewMode") === "true";

  useCheckJwtAndGotoLogin(client.offlineMode.value || viewMode);

  const httpRequest = useHttpRequest();

  const userId = getAuthorization()?.payload.userId;

  const docId = urlParams.get("docId");

  const [docInstance, setDocInstance] = useState<NoteDocument | null>(null);

  if (!docId) {
    return null;
  }

  useEffect(() => {
    if (!viewMode) {
      client.headerView.value = (
        <Box display="flex" alignItems="center" sx={{}}>
          <Space />
          <Share docId={docId} />
          {!offlineMode && (
            <>
              <Space />
              {synchronized ? (
                <CloudDoneRoundedIcon />
              ) : (
                <CloudSyncRoundedIcon />
              )}
            </>
          )}
          <Space />
          {saving ? <SaveAltRoundedIcon /> : <SaveRoundedIcon />}
          <Space />
          {needSave ? <FiberManualRecordIcon /> : null}
        </Box>
      );
    }
    return () => {
      client.headerView.value = null;
    };
  }, [synchronized, saving, needSave, viewMode, offlineMode]);

  useEffect(() => {
    setDisconnected(false);
  }, [docId]);

  useEffect(() => {
    const editor: Editor = {
      onInit: function (doc): void {
        setLoading(true);
        setDocInstance(doc);
      },
      onOfflineLoaded: function (): void {
        setLoading(false);
      },
      onConnected: function (): void {
        setLoading(false);
        setDisconnected(false);
      },
      onDisconnected: () => {
        setLoading(true);
        setDisconnected(true);
      },
      getOrigin: () => undefined,
      getHttpRequest: () => httpRequest,
      setLoading,
      setDocInfo,
      setUserListMessage,
      setSynchronized,
      setSaving,
      setNeedSave,
    };

    const doc = new NoteDocument(
      editor,
      new MessageBridge(),
      docId,
      client,
      viewMode,
    );
    doc.init();
    return () => {
      setSynchronized(false);
      doc.askAutoSavingLocal();
      doc.destroy();
      setDocInstance(null);
      setDisconnected(false);
      setReloading(true);
    };
  }, [docId, userId, offlineMode]);

  const showSideBar = window.innerWidth >= 760 && !viewMode;

  return (
    <Box
      sx={{
        position: "absolute",
        top: "50px",
        bottom: "0px",
        left: "0px",
        right: "0px",
      }}
    >
      <Container
        maxWidth="lg"
        sx={{
          height: "100%",
        }}
      >
        <Stack spacing={1} direction="row" sx={{ height: "100%" }}>
          {showSideBar && <SideList client={client} selectedId={docId} />}
          <Box
            id="note-editor-right"
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: "#88888833 #f1f1f100",
            }}
          >
            <Box
              sx={{
                position: "relative",
                height: "36px",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  height: "36px",
                  position: "absolute",
                  left: "0px",
                  maxWidth: "100%",
                }}
              >
                <Box
                  sx={{
                    marginTop: "6px",
                    height: "36px",
                    flexShrink: 0,
                  }}
                >
                  {/* 
              docInfo?.is_public ? (
                <VisibilityRoundedIcon />
              ) : (
                <LockRoundedIcon />
              )
              */}
                </Box>
                <ListItemButton
                  sx={{
                    fontSize: "22px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    lineHeight: "36px",
                  }}
                  onClick={() => {
                    if (!docInstance) {
                      return;
                    }
                    const yjsSize = Y.encodeStateAsUpdate(
                      docInstance.yDoc,
                    ).length;

                    GlobalSnackBar.getInstance().pushMessage(
                      `Size:${toSizeString(yjsSize)} (${yjsSize})`,
                    );
                  }}
                >
                  {docInfo?.title}
                </ListItemButton>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  position: "absolute",
                  right: "0px",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    maxWidth: "100px",
                  }}
                >
                  {userListMessage?.data.userList.map((u, index) => {
                    const { r, g, b } = hashColorWitchCache(u.userId);
                    const sizeN = 32;
                    const size = `${sizeN}px`;
                    return (
                      <Box
                        sx={{
                          backgroundColor: `rgb(${r}, ${g}, ${b})`,
                          boxSizing: "content-box",
                          border: `solid white`,
                          width: size,
                          height: size,
                          // borderRadius: (t) => `${t.shape.borderRadius}px`,
                          borderRadius: `${sizeN}px`,
                          lineHeight: size,
                          textAlign: "center",
                          color: "white",
                          fontSize: `${Math.floor(sizeN * (2 / 3))}px`,
                          marginLeft: `${index === 0 ? 0 : -24}px`,
                          userSelect: "none",
                        }}
                        key={u.userSessionId}
                      >
                        {u.userId[0].toUpperCase()}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
            <div id="editor-top" />
            <div
              style={{
                visibility: loading ? "hidden" : "visible",
                opacity: loading ? 0 : 1,
                transition: "ease-out 0.5s",
                border: "none",
              }}
            >
              <CoreEditor
                client={client}
                docInstance={docInstance}
                onBind={() => {
                  // setLoading(true);
                }}
              />
            </div>
            {(loading || disconnected) && (
              <Box
                sx={{
                  position: "fixed",
                  width: "100px",
                  height: "100px",
                  top: "50%",
                  left: "50%",
                  transform: "translate( -50%, -50%)",
                  textAlign: "center",
                  lineHeight: "100px",
                }}
              >
                {loading && (
                  <Box>
                    <CircularProgress size={36} />
                  </Box>
                )}
                {disconnected && !reloading && (
                  <Box>
                    <Button
                      variant="contained"
                      onClick={() => {
                        setLoading(true);
                        setReloading(true);
                        location.reload();
                      }}
                    >
                      {i18n("reconnect_button_text")}
                    </Button>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Stack>
        {!reloading && (
          <Fab
            style={{
              position: "fixed",
              right: "16px",
              bottom: "100px",
            }}
            variant="circular"
            color="primary"
            onClick={() => {
              setLoading(true);
              setReloading(true);
              location.reload();
            }}
          >
            <RefreshRounded />
          </Fab>
        )}

        {needSave && !saving && (
          <Fab
            style={{
              position: "fixed",
              right: "16px",
              bottom: "32px",
            }}
            variant="circular"
            onClick={() => {
              docInstance?.trySaveLocal();
            }}
          >
            <SaveRoundedIcon />
          </Fab>
        )}
      </Container>
    </Box>
  );
};
