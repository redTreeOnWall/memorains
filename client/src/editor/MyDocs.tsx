import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import {
  useBindableProperty,
  useCheckJwtAndGotoLogin,
  useHttpRequest,
} from "../hooks/hooks";
import { S2C_DocListMessage } from "../interface/HttpMessage";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";
import { getAuthorization } from "../utils/getAuthorization";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuList,
  Tooltip,
} from "@mui/material";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import DraftsRoundedIcon from "@mui/icons-material/DraftsRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import { InputNameDialog } from "../components/common/InputNameDialog";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
// import CreateRoundedIcon from "@mui/icons-material/CreateRounded";
import { IClient } from "../interface/Client";
import { DocType, DocumentEntity } from "../interface/DataEntity";
import moment from "moment";
import { i18n } from "../internationnalization/utils";
import Format from "string-format";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import { Space } from "../components/common/Space";

import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import { CreateDoc, createDocument } from "../components/CreateDoc";
import { getCryptoKeyFromLocal, setCryptoKeyToLocal } from "../utils/utils";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import SyncLockRoundedIcon from "@mui/icons-material/SyncLockRounded";
import { syncEncryptedData } from "../utils/docData";
import { Base64 } from "js-base64";

export const MyDocs: React.FC<{ client: IClient }> = ({ client }) => {
  const [loading, setLoading] = useState(true);
  const [onlineDocList, setOnlineDocList] = useState<
    S2C_DocListMessage["data"]["docList"]
  >([]);
  const [offlineDocList, setOfflineDocList] = useState<DocumentEntity[]>([]);
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

  const updatingRemoteListRef = useRef(false);

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

    offlineDocList.forEach((doc) => {
      if (!viewListMap.has(doc.id)) {
        viewListMap.set(doc.id, { offlineData: doc });
      }
      const exitData = viewListMap.get(doc.id);
      if (exitData) {
        exitData.offlineData = doc;
      }
    });

    onlineDocList.forEach((doc) => {
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

    viewList.sort((a, b) => {
      const aData = a.onlineData ?? a.offlineData;
      const bData = b.onlineData ?? b.offlineData;
      if (aData && bData) {
        const aTime = moment(aData.create_date).valueOf();
        const bTime = moment(bData.create_date).valueOf();
        return bTime - aTime;
      }
      return 0;
      // return aData.
    });

    return viewList;
  }, [onlineDocList, offlineDocList]);

  const httpRequest = useHttpRequest();
  const navigate = useNavigate();
  useCheckJwtAndGotoLogin(offlineMode);
  const userId = offlineMode ? undefined : getAuthorization()?.payload.userId;

  const updateDocList = useCallback(async () => {
    setLoading(true);
    const requests: Promise<void>[] = [];

    if (!offlineMode) {
      const requestOnline = (async () => {
        updatingRemoteListRef.current = true;
        const result = await httpRequest("docList", undefined);
        if (result) {
          setOnlineDocList(result.data.docList);
        }
        updatingRemoteListRef.current = false;
      })();
      requests.push(requestOnline);
    }

    const requestOffline = (async () => {
      const allOfflineDocuments = await client.db.getDocumentList();
      const online = !offlineMode && userId;
      // FIXME
      const offlineList = online
        ? allOfflineDocuments.filter(
            (f) => f.user_id === userId || f.user_id === "offline",
          )
        : allOfflineDocuments;
      setOfflineDocList(offlineList);
    })();

    requests.push(requestOffline);

    await Promise.race(requests);
    setLoading(false);
  }, [userId, httpRequest, setLoading, offlineMode, client]);

  const creatDoc = async (docType: DocType) => {
    setLoading(true);
    await createDocument(docType, client, httpRequest);
    setLoading(false);
    await updateDocList();
    // const createOnline = async () => {
    //   setLoading(true);
    //   const result = await httpRequest("createDoc", { docType });
    //   await awaitTime(500);
    //   setLoading(false);
    //   if (result?.success) {
    //     GlobalSnackBar.getInstance().pushMessage(
    //       i18n("new_document_created"),
    //       "success",
    //     );
    //   } else {
    //     GlobalSnackBar.getInstance().pushMessage(
    //       i18n("new_document_created_failed"),
    //       "error",
    //     );
    //   }
    // };

    // const createOffline = async () => {
    //   setLoading(true);
    //   const date = new Date();
    //   const createTime = moment(date).format("YYYY-MM-DD HH:mm:ss");
    //   const newDoc: DocumentEntity = {
    //     id: uuid(),
    //     title: `${i18n("new_offline_document")} ${createTime}`,
    //     user_id: userId ?? "offline",
    //     create_date: createTime,
    //     last_modify_date: createTime,
    //     state: null,
    //     is_public: 0,
    //     commit_id: randomInt(),
    //     doc_type: docType,
    //   };
    //   client.db.createOrUpdateDoc(newDoc);
    //   setLoading(false);
    // };

    // if (offlineMode) {
    //   // GlobalSnackBar.getInstance().pushMessage(
    //   //   `Please sign in and create document.`,
    //   //   "error"
    //   // );
    //   // TODO create local document
    //   await createOffline();
    // } else {
    //   await createOnline();
    // }
  };

  const deleteDoc = async (docID: string, docName: string) => {
    setLoading(true);
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
    setLoading(false);
    await updateDocList();
  };

  const renameDocument = async (docID: string, newName: string) => {
    if (!docID || !newName) {
      return;
    }
    setLoading(true);
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
    setLoading(false);
    updateDocList();
  };

  useEffect(() => {
    updateDocList();
  }, [updateDocList, docListUpdateIndex]);

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          backgroundColor: (theme) => theme.palette.background.paper,
          minHeight: "500px",
        }}
      >
        {loading && (
          <Box
            sx={{
              textAlign: "center",
              marginTop: (theme) => theme.spacing(),
            }}
          >
            <CircularProgress size={36} />
          </Box>
        )}

        {!loading && (
          <Box>
            {docViewList.length === 0 && (
              <Box
                sx={{
                  textAlign: "center",
                }}
              >
                <DraftsRoundedIcon
                  sx={{
                    width: "60px",
                    height: "60px",
                    color: (theme) => theme.palette.grey.A700,
                  }}
                />
                <Box>{i18n("no_any_document")}</Box>
                <Box margin={(t) => t.spacing()}>
                  <Button
                    variant="contained"
                    onClick={() => {
                      creatDoc(DocType.text);
                    }}
                  >
                    {i18n("new_document_button")}
                  </Button>
                </Box>
                <Box margin={(t) => t.spacing()}>
                  <Button
                    color="secondary"
                    variant="contained"
                    onClick={() => {
                      creatDoc(DocType.canvas);
                    }}
                  >
                    {i18n("new_canvas_button")}
                  </Button>
                </Box>

                <Box margin={(t) => t.spacing()}>
                  <CreateDoc
                    client={client}
                    onCreated={() => {
                      updateDocList();
                    }}
                  />
                </Box>
              </Box>
            )}

            {docViewList.length != 0 && (
              <Box sx={{ width: "100%" }}>
                <CreateDoc
                  client={client}
                  onCreated={() => {
                    updateDocList();
                  }}
                />
                <Space />

                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => {
                    creatDoc(DocType.text);
                  }}
                >
                  + <ArticleRoundedIcon />
                </Button>
                <Space></Space>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={() => {
                    creatDoc(DocType.canvas);
                  }}
                >
                  + <ColorLensRoundedIcon />
                </Button>
              </Box>
            )}
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
                  <ListItem disablePadding key={id}>
                    <ListItemButton
                      sx={{ paddingLeft: 0 }}
                      onClick={async () => {
                        setLoading(true);

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
                          !updatingRemoteListRef.current;

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
                            const exitedCrypto =
                              await getCryptoKeyFromLocal(id);
                            if (exitedCrypto) {
                              await setCryptoKeyToLocal(
                                openId,
                                exitedCrypto.cryptoKey,
                              );
                            }
                            await client.db.updateId(id, openId);
                          }
                        }

                        setLoading(false);
                        // TODO create and sync remote document.

                        if (doc_type === DocType.text) {
                          navigate(`/document?docId=${openId}`);
                        } else if (doc_type === DocType.canvas) {
                          navigate(`/canvas?docId=${openId}`);
                        }
                      }}
                    >
                      {(() => {
                        const isOwner = user_id === userId;
                        // const OwnerIcon = isOwner ? ArticleRoundedIcon : GroupRoundedIcon;
                        const DocTypeIcon =
                          doc_type === DocType.canvas
                            ? ColorLensRoundedIcon
                            : ArticleRoundedIcon;
                        const tipText = isOwner
                          ? i18n("this_document_created_by_you")
                          : i18n("this_document_created_by_others");

                        const size = 12;

                        const SmallIcon: React.FC<{
                          Icon: typeof SaveRoundedIcon;
                        }> = ({ Icon }) => (
                          <Box
                            sx={{
                              width: `${size}px`,
                              height: `${size}px`,
                              position: "relative",
                              top: "0px",
                              left: "0px",
                              color: (theme) => theme.palette.grey[600],
                            }}
                          >
                            <Icon
                              sx={{
                                width: `100%`,
                                height: `100%`,
                                position: "absolute",
                                left: `0%`,
                                top: `0%`,
                              }}
                            />
                          </Box>
                        );

                        return (
                          <Tooltip title={tipText}>
                            <Box
                              sx={{
                                position: "relative",
                                width: "24px",
                                height: "24px",
                              }}
                            >
                              {/* <OwnerIcon /> */}

                              <DocTypeIcon />

                              <Box
                                sx={{
                                  width: `${size * 3}px`,
                                  height: `${size}px`,
                                  position: "absolute",
                                  bottom: `${-size * 0.7}px`,
                                  left: `${-(size * 3 - 24) / 2}px`,
                                  display: "flex",
                                  justifyContent: "center",
                                  // backgroundColor: "#00ff0088",
                                }}
                              >
                                {/* needSync ? (
                                  <SmallIcon Icon={SyncIcon} />
                                ) : null*/}
                                {doc.onlineData ? (
                                  <SmallIcon Icon={CloudDoneRoundedIcon} />
                                ) : null}
                                {doc.offlineData ? (
                                  <SmallIcon Icon={SaveRoundedIcon} />
                                ) : null}
                                {data.encrypt_salt ? (
                                  <SmallIcon Icon={KeyRoundedIcon} />
                                ) : null}
                              </Box>
                            </Box>
                          </Tooltip>
                        );
                      })()}
                      <Tooltip title={title}>
                        <ListItemText
                          sx={{
                            margin: (theme) => theme.spacing(),
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                          primary={title}
                        />
                      </Tooltip>
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
                );
              })}
            </List>
            {(() => {
              const renameDoc = renameDocId
                ? docViewList.find(
                    (d) =>
                      (d.offlineData?.id ?? d.onlineData?.id) === renameDocId,
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
              buttonText={i18n("delete_document_panel_delete_button")}
              onConfirm={() => {
                if (deleteDocInfo) {
                  setDeleteDocInfo(undefined);
                  deleteDoc(deleteDocInfo.id, deleteDocInfo.name);
                }
              }}
              onClose={() => {
                setDeleteDocInfo(undefined);
              }}
            />
          </Box>
        )}

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
                    setLoading(true);

                    // Sync encrypted data
                    const id = moreMenu.id;
                    try {
                      await syncEncryptedData(id, client, httpRequest);
                    } catch (e) {
                      console.error(e);
                    }
                    // setRenameDocId(moreMenu!.id);
                    await updateDocList();
                    setLoading(false);
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
    </Container>
  );
};
