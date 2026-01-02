import React, { useEffect, useMemo, useState } from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { useBindableProperty, useHttpRequest } from "../hooks/hooks";
import { S2C_DocListMessage } from "../interface/HttpMessage";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";
import { getAuthorization } from "../utils/getAuthorization";
import { useNavigate } from "react-router-dom";
import {
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuList,
  Tooltip,
  Divider,
} from "@mui/material";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import TaskRoundedIcon from "@mui/icons-material/TaskRounded";
import { InputNameDialog } from "../components/common/InputNameDialog";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
// import CreateRoundedIcon from "@mui/icons-material/CreateRounded";
import { IClient } from "../interface/Client";
import { DocType, DocumentEntity } from "../interface/DataEntity";
import moment from "moment";
import { i18n } from "../internationnalization/utils";
import Format from "string-format";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";

import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import {
  getCryptoKeyFromLocal,
  openDoc,
  setCryptoKeyToLocal,
  formatRelativeTime,
} from "../utils/utils";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import SyncLockRoundedIcon from "@mui/icons-material/SyncLockRounded";
import { syncEncryptedData } from "../utils/docData";
import { Base64 } from "js-base64";
import { DOC_TYPE_CONFIG } from "../const/docTypeConfig";

export interface NoteListViewProps {
  client: IClient;
  onlineDocList: S2C_DocListMessage["data"]["docList"] | null;
  offlineDocList: DocumentEntity[] | null;
  onRequestUpdateList: () => Promise<void>;
  /** default is true */
  sortByCreateDate?: boolean;
  selectedId?: string;
}

export const NoteListView: React.FC<NoteListViewProps> = ({
  client,
  onlineDocList,
  offlineDocList,
  onRequestUpdateList,
  sortByCreateDate = true,
  selectedId,
}) => {
  const offlineListLoading = offlineDocList === null;
  const [innerLoading, setInnerLoading] = useState(false);
  const loading = offlineListLoading || innerLoading;
  const [renameDocId, setRenameDocId] = useState<string | undefined>();
  const [deleteDocInfo, setDeleteDocInfo] = useState<
    { id: string; name: string } | undefined
  >();

  const [moreMenu, setMoreMenu] = React.useState<null | {
    anchorEl?: HTMLElement;
    id: string;
    title: string;
    docOwnerId: string;
    isOnlineDoc: boolean;
    encrypted: boolean;
  }>(null);

  const offlineMode = useBindableProperty(client.offlineMode);
  const docListUpdateIndex = useBindableProperty(client.docListUpdateIndex);

  const docViewList = useMemo(() => {
    const viewList: (
      | {
          onlineData: S2C_DocListMessage["data"]["docList"][number];
          offlineData?: DocumentEntity;
        }
      | {
          onlineData?: S2C_DocListMessage["data"]["docList"][number];
          offlineData: DocumentEntity;
        }
    )[] = [];

    const viewListMap = new Map<string, (typeof viewList)[number]>();

    offlineDocList?.forEach((doc) => {
      if (!viewListMap.has(doc.id)) {
        viewListMap.set(doc.id, { offlineData: doc });
      }
      const exitData = viewListMap.get(doc.id);
      if (exitData) {
        exitData.offlineData = doc;
      }
    });

    onlineDocList?.forEach((doc) => {
      if (!viewListMap.has(doc.id)) {
        viewListMap.set(doc.id, { onlineData: doc });
      }
      const exitData = viewListMap.get(doc.id);
      if (exitData) {
        exitData.onlineData = doc;
      }
    });

    viewListMap.forEach((value) => {
      viewList.push(value);
    });

    if (sortByCreateDate) {
      viewList.sort((a, b) => {
        const aData = a.onlineData ?? a.offlineData;
        const bData = b.onlineData ?? b.offlineData;
        if (aData && bData) {
          const aTime = moment(aData.create_date).valueOf();
          const bTime = moment(bData.create_date).valueOf();
          return bTime - aTime;
        }
        return 0;
      });
    }

    return viewList;
  }, [onlineDocList, offlineDocList, sortByCreateDate]);

  const httpRequest = useHttpRequest();
  const navigate = useNavigate();
  const userId = offlineMode ? undefined : getAuthorization()?.payload.userId;

  const deleteDoc = async (docID: string, docName: string) => {
    setInnerLoading(true);
    if (!offlineMode) {
      const result = await httpRequest("deleteDoc", { docID });
      if (result?.success) {
        GlobalSnackBar.getInstance().pushMessage(
          Format(i18n("one_document_deleted"), { docName }),
          "success",
        );
      } else {
        GlobalSnackBar.getInstance().pushMessage(
          `${docName} deleted failed.`,
          "error",
        );
      }
    }
    try {
      await client.db.deleteDoc(docID);
    } catch (e) {
      console.error(e);
      // nothing
    }
    setInnerLoading(false);
    await onRequestUpdateList();
  };

  const renameDocument = async (docID: string, newName: string) => {
    if (!docID || !newName) {
      return;
    }
    setInnerLoading(true);
    if (!offlineMode) {
      const result = await httpRequest("updateDocName", { docID, newName });
      if (result?.success) {
        GlobalSnackBar.getInstance().pushMessage(
          i18n("rename_success"),
          "success",
        );
      } else {
        GlobalSnackBar.getInstance().pushMessage(
          i18n("rename_failed"),
          "success",
        );
      }
    }
    try {
      const localDoc = await client.db.getDocById(docID);
      if (localDoc) {
        localDoc.title = newName;
        client.db.createOrUpdateDoc(localDoc);
      }
    } catch (e) {
      console.error(e);
    }
    setInnerLoading(false);
    await onRequestUpdateList();
  };

  useEffect(() => {
    onRequestUpdateList();
  }, [onRequestUpdateList, docListUpdateIndex]);

  if (loading) {
    return (
      <Box
        sx={{
          textAlign: "center",
          marginTop: (theme) => theme.spacing(),
        }}
      >
        <CircularProgress size={36} />
      </Box>
    );
  }

  return (
    <Box>
      <Box>
        <List>
          {docViewList.map((doc) => {
            // TODO
            const data = doc.onlineData ?? doc.offlineData;
            if (!data) {
              return null;
            }
            const id = data.id;
            const user_id = data.user_id;
            const title = data.title;
            // const needSync =
            //   doc.offlineData?.commit_id !== doc.onlineData?.commit_id;
            const doc_type = data.doc_type ?? DocType.text;
            return (
              <React.Fragment key={id}>
                <ListItem disablePadding>
                  <ListItemButton
                    selected={selectedId !== undefined && selectedId === id}
                    sx={{
                      paddingLeft: 0,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1,
                    }}
                    onClick={async () => {
                      setInnerLoading(true);

                      const onlyRemote =
                        !offlineMode && !doc.offlineData && doc.onlineData;

                      const showError = () => {
                        GlobalSnackBar.getInstance().pushMessage(
                          "Can not open this document because it is an encrypted doc from remote. Please sync it firstly!",
                        );
                      };
                      if (onlyRemote && doc.onlineData?.encrypt_salt) {
                        try {
                          await syncEncryptedData(id, client, httpRequest);
                          // check
                          const newData = await client.db.getDocById(id);
                          if (!newData) {
                            showError();
                            return;
                          }
                        } catch (e) {
                          console.log(e);
                          showError();
                          return;
                        }
                      }

                      const onlyLocal =
                        !offlineMode &&
                        doc.offlineData &&
                        !doc.onlineData &&
                        onlineDocList !== null;

                      let openId = id;

                      if (onlyLocal) {
                        const cloneDoc = await httpRequest("createDoc", {
                          newDoc: {
                            id,
                            title,
                            create_date: doc.offlineData?.create_date,
                            doc_type: doc_type,
                            encrypt_salt: doc.offlineData?.encrypt_salt,
                            state: Base64.fromUint8Array(
                              new Uint8Array(
                                doc.offlineData?.state ?? new ArrayBuffer(0),
                              ),
                            ),
                          },
                          docType: doc_type,
                        });
                        if (cloneDoc?.success && cloneDoc?.data?.newDocId) {
                          openId = cloneDoc.data.newDocId;
                          // FIXME
                          const exitedCrypto = await getCryptoKeyFromLocal(id);
                          if (exitedCrypto) {
                            await setCryptoKeyToLocal(
                              openId,
                              exitedCrypto.cryptoKey,
                            );
                          }
                          await client.db.updateId(id, openId);
                        }
                      }

                      setInnerLoading(false);
                      // TODO create and sync remote document.

                      openDoc(doc_type, openId, navigate);
                    }}
                  >
                    {/* Right side: Title, dates, and small icons */}
                    <Box sx={{ flex: 1, overflow: "hidden" }}>
                      {/* Top row: Doc type icon, small icons and modified date */}
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          marginBottom: 0.25,
                          minHeight: "20px",
                          fontSize: "0.75rem",
                          color: "text.secondary",
                        }}
                      >
                        {(() => {
                          const isOwner = user_id === userId;
                          let DocTypeIcon = ArticleRoundedIcon;
                          let docTypeText = i18n("doc_type_article");
                          if (doc_type === DocType.canvas) {
                            DocTypeIcon = ColorLensRoundedIcon;
                            docTypeText = i18n("doc_type_canvas");
                          } else if (doc_type === DocType.todo) {
                            DocTypeIcon = TaskRoundedIcon;
                            docTypeText = i18n("doc_type_todo");
                          }
                          const ownerText = isOwner
                            ? i18n("this_document_created_by_you")
                            : i18n("this_document_created_by_others");
                          const config = DOC_TYPE_CONFIG[doc_type];

                          return (
                            <Tooltip title={`${docTypeText} • ${ownerText}`}>
                              <Box sx={{ width: "20px", height: "20px" }}>
                                <DocTypeIcon
                                  sx={{ fontSize: 20, color: config.mainColor }}
                                />
                              </Box>
                            </Tooltip>
                          );
                        })()}
                        {doc.onlineData ? (
                          <Tooltip title={i18n("online_sync")}>
                            <CloudDoneRoundedIcon sx={{ fontSize: 14 }} />
                          </Tooltip>
                        ) : null}
                        {doc.offlineData ? (
                          <Tooltip title={i18n("offline_saved")}>
                            <SaveRoundedIcon sx={{ fontSize: 14 }} />
                          </Tooltip>
                        ) : null}
                        {data.encrypt_salt ? (
                          <Tooltip title={i18n("encrypted")}>
                            <KeyRoundedIcon sx={{ fontSize: 14 }} />
                          </Tooltip>
                        ) : null}
                        <span>{formatRelativeTime(data.last_modify_date)}</span>
                      </Box>

                      {/* Title */}
                      <Tooltip title={title}>
                        <Box
                          sx={{
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            fontWeight: 500,
                          }}
                        >
                          {title}
                        </Box>
                      </Tooltip>
                    </Box>
                  </ListItemButton>

                  <>
                    <IconButton
                      onClick={(e) => {
                        setMoreMenu({
                          anchorEl: e.currentTarget,
                          id,
                          title,
                          docOwnerId: user_id,
                          isOnlineDoc: !!doc.onlineData,
                          encrypted: !!data.encrypt_salt,
                        });
                      }}
                    >
                      <MoreHorizRoundedIcon />
                    </IconButton>
                  </>
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            );
          })}
        </List>
        {(() => {
          const renameDoc = renameDocId
            ? docViewList.find(
                (d) => (d.offlineData?.id ?? d.onlineData?.id) === renameDocId,
              )
            : undefined;
          const renameTittle =
            renameDoc?.offlineData?.title ?? renameDoc?.onlineData?.title;
          const renameId =
            renameDoc?.onlineData?.id ?? renameDoc?.offlineData?.id;
          return (
            <InputNameDialog
              open={!!renameDoc}
              title={i18n("rename_document_panel_title")}
              label={i18n("rename_document_panel_second_title")}
              buttonText={i18n("rename_document_panel_confirm_button")}
              initText={renameTittle}
              onConfirm={(newName) => {
                setRenameDocId(undefined);
                if (renameId) {
                  renameDocument(renameId, newName);
                }
              }}
              onClose={() => {
                setRenameDocId(undefined);
              }}
            />
          );
        })()}

        <ConfirmDialog
          open={!!deleteDocInfo}
          title={i18n("delete_document_panel_title")}
          content={Format(i18n("delete_document_panel_text"), {
            docName: deleteDocInfo?.name,
          })}
          confirmText={i18n("delete_document_panel_delete_button")}
          onConfirm={() => {
            if (deleteDocInfo) {
              setDeleteDocInfo(undefined);
              deleteDoc(deleteDocInfo.id, deleteDocInfo.name);
            }
          }}
          onClose={() => {
            setDeleteDocInfo(undefined);
          }}
          confirmColor="error"
        />
      </Box>

      <Menu
        open={moreMenu !== null}
        anchorEl={moreMenu?.anchorEl}
        onClose={() => {
          setMoreMenu(null);
        }}
      >
        {moreMenu ? (
          <MenuList sx={{ width: 320, maxWidth: "100%" }}>
            {moreMenu.encrypted ? (
              <MenuItem
                onClick={async () => {
                  setMoreMenu(null);
                  setInnerLoading(true);

                  // Sync encrypted data
                  const id = moreMenu.id;
                  try {
                    await syncEncryptedData(id, client, httpRequest);
                  } catch (e) {
                    console.error(e);
                  }
                  // setRenameDocId(moreMenu!.id);
                  await onRequestUpdateList();
                  setInnerLoading(false);
                }}
              >
                <ListItemIcon>
                  <SyncLockRoundedIcon />
                </ListItemIcon>
                <ListItemText>{i18n("sync_encrypted_document")}</ListItemText>
              </MenuItem>
            ) : null}
            <MenuItem
              onClick={() => {
                setRenameDocId(moreMenu!.id);
                setMoreMenu(null);
              }}
            >
              <ListItemIcon>
                <DriveFileRenameOutlineRoundedIcon />
              </ListItemIcon>
              <ListItemText>{i18n("rename_doc")}</ListItemText>
            </MenuItem>
            {moreMenu.docOwnerId === userId || !moreMenu?.isOnlineDoc ? (
              <MenuItem
                sx={{ color: (t) => t.palette.error.main }}
                onClick={() => {
                  setMoreMenu(null);
                  setDeleteDocInfo({
                    id: moreMenu!.id,
                    name: moreMenu!.title,
                  });
                }}
              >
                <ListItemIcon>
                  <DeleteRoundedIcon
                    sx={{ color: (t) => t.palette.error.main }}
                  />
                </ListItemIcon>
                <ListItemText>{i18n("delete_doc")}</ListItemText>
              </MenuItem>
            ) : null}
          </MenuList>
        ) : (
          <MenuList sx={{ width: 320, maxWidth: "100%", height: 80 }} />
        )}
      </Menu>
    </Box>
  );
};
