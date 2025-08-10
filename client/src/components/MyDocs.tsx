import React, { useCallback, useEffect, useState } from "react";
import {
  useBindableProperty,
  useCheckJwtAndGotoLogin,
  useHttpRequest,
} from "../hooks/hooks";
import { S2C_DocListMessage } from "../interface/HttpMessage";
import { getAuthorization } from "../utils/getAuthorization";
import { Box, Button, Container } from "@mui/material";
import DraftsRoundedIcon from "@mui/icons-material/DraftsRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
// import CreateRoundedIcon from "@mui/icons-material/CreateRounded";
import { IClient } from "../interface/Client";
import { DocType, DocumentEntity } from "../interface/DataEntity";
import { i18n } from "../internationnalization/utils";
import { Space } from "../components/common/Space";

import { CreateDoc, createDocument } from "../components/CreateDoc";
import { NoteListView } from "./NoteListView";

export const MyDocs: React.FC<{ client: IClient }> = ({ client }) => {
  const [onlineDocList, setOnlineDocList] = useState<
    S2C_DocListMessage["data"]["docList"] | null
  >(null);
  const [offlineDocList, setOfflineDocList] = useState<DocumentEntity[] | null>(
    null,
  );

  const offlineMode = useBindableProperty(client.offlineMode);

  const httpRequest = useHttpRequest();
  useCheckJwtAndGotoLogin(offlineMode);
  const userId = offlineMode ? undefined : getAuthorization()?.payload.userId;

  const updateDocList = useCallback(async () => {
    setOfflineDocList(null);
    const requests: Promise<void>[] = [];

    if (!offlineMode) {
      const requestOnline = (async () => {
        const result = await httpRequest("docList", undefined);
        if (result) {
          setOnlineDocList(result.data.docList);
        }
      })();
      requests.push(requestOnline);
    }

    const requestOffline = (async () => {
      const allOfflineDocuments = await client.db.getDocumentList();
      const online = !offlineMode && userId;
      const offlineList = online
        ? allOfflineDocuments.filter(
            (f) => f.user_id === userId || f.user_id === "offline",
          )
        : allOfflineDocuments;
      setOfflineDocList(offlineList);
    })();

    requests.push(requestOffline);

    await Promise.race(requests);
  }, [userId, httpRequest, offlineMode, client]);

  const creatDoc = async (docType: DocType) => {
    setOfflineDocList(null);
    await createDocument(docType, client, httpRequest);
    await updateDocList();
  };

  useEffect(() => {
    updateDocList();
  }, [updateDocList]);

  let empty = true;
  if (offlineMode) {
    empty = offlineDocList?.length === 0;
  } else {
    empty = offlineDocList?.length === 0 && onlineDocList?.length === 0;
  }

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          backgroundColor: (theme) => theme.palette.background.paper,
          minHeight: "500px",
        }}
      >
        {!empty && (
          <Box>
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
            <NoteListView
              client={client}
              onlineDocList={onlineDocList}
              offlineDocList={offlineDocList}
              onRequestUpdateList={updateDocList}
            />
          </Box>
        )}

        {empty && (
          <Box>
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
          </Box>
        )}
      </Box>
    </Container>
  );
};
