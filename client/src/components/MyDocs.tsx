import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useBindableProperty,
  useCheckJwtAndGotoLogin,
  useHttpRequest,
} from "../hooks/hooks";
import { S2C_DocListMessage } from "../interface/HttpMessage";
import { getAuthorization } from "../utils/getAuthorization";
import {
  Box,
  Button,
  Container,
  TextField,
  InputAdornment,
} from "@mui/material";
import DraftsRoundedIcon from "@mui/icons-material/DraftsRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import TaskRoundedIcon from "@mui/icons-material/TaskRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
// import CreateRoundedIcon from "@mui/icons-material/CreateRounded";
import { IClient } from "../interface/Client";
import { DocType, DocumentEntity } from "../interface/DataEntity";
import { i18n } from "../internationnalization/utils";
import { Space } from "../components/common/Space";

import { CreateDoc, createDocument } from "../components/CreateDoc";
import { NoteListView } from "./NoteListView";

export const MyDocs: React.FC<{
  client: IClient;
  selectedId?: string;
  showAllCreateButtons?: boolean;
}> = ({ client, selectedId, showAllCreateButtons }) => {
  const [onlineDocList, setOnlineDocList] = useState<
    S2C_DocListMessage["data"]["docList"] | null
  >(null);
  const [offlineDocList, setOfflineDocList] = useState<DocumentEntity[] | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");

  client.lastDocHaveBeenOpen = true;

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

  // Filter documents based on search query
  const filteredOnlineDocList = useMemo(() => {
    if (!searchQuery.trim() || !onlineDocList) return onlineDocList;
    const query = searchQuery.toLowerCase();
    return onlineDocList.filter((doc) =>
      doc.title.toLowerCase().includes(query),
    );
  }, [onlineDocList, searchQuery]);

  const filteredOfflineDocList = useMemo(() => {
    if (!searchQuery.trim() || !offlineDocList) return offlineDocList;
    const query = searchQuery.toLowerCase();
    return offlineDocList.filter((doc) =>
      doc.title.toLowerCase().includes(query),
    );
  }, [offlineDocList, searchQuery]);

  // Check if there are any documents at all (not filtered)
  let hasAnyDocs = true;
  if (offlineMode) {
    hasAnyDocs = offlineDocList?.length === 0;
  } else {
    hasAnyDocs = offlineDocList?.length === 0 && onlineDocList?.length === 0;
  }

  // Check if filtered results are empty (for showing "no results" message)
  let noFilteredResults = true;
  if (offlineMode) {
    noFilteredResults = filteredOfflineDocList?.length === 0;
  } else {
    noFilteredResults = filteredOfflineDocList?.length === 0 && filteredOnlineDocList?.length === 0;
  }

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          backgroundColor: (theme) => theme.palette.background.paper,
          minHeight: "500px",
        }}
      >
        {/* Case 1: No documents at all */}
        {hasAnyDocs && (
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
                <Button
                  color="info"
                  variant="contained"
                  onClick={() => {
                    creatDoc(DocType.todo);
                  }}
                >
                  {i18n("new_todo_button")}
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

        {/* Case 2 & 3: Has documents */}
        {!hasAnyDocs && (
          <Box>
            <Box sx={{ width: "100%" }}>
              <CreateDoc
                client={client}
                onCreated={() => {
                  updateDocList();
                }}
              />

              {showAllCreateButtons && (
                <>
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
                  <Space></Space>
                  <Button
                    variant="outlined"
                    color="info"
                    onClick={() => {
                      creatDoc(DocType.todo);
                    }}
                  >
                    + <TaskRoundedIcon />
                  </Button>
                </>
              )}
            </Box>

            {/* Search Box */}
            <Box sx={{ mt: 2, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                placeholder={i18n("search_documents")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            {/* Case 2: Search results empty */}
            {noFilteredResults && searchQuery.trim() && (
              <Box
                sx={{
                  textAlign: "center",
                  py: 4,
                  color: (theme) => theme.palette.text.secondary,
                }}
              >
                <DraftsRoundedIcon
                  sx={{
                    width: "50px",
                    height: "50px",
                    mb: 1,
                    color: (theme) => theme.palette.grey.A400,
                  }}
                />
                <Box>
                  {i18n("no_search_results") || "No documents found matching your search."}
                </Box>
              </Box>
            )}

            {/* Case 3: Show filtered results */}
            {!noFilteredResults && (
              <NoteListView
                client={client}
                onlineDocList={filteredOnlineDocList}
                offlineDocList={filteredOfflineDocList}
                onRequestUpdateList={updateDocList}
                selectedId={selectedId}
              />
            )}
          </Box>
        )}
      </Box>
    </Container>
  );
};
