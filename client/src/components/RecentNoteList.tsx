import React, { useCallback, useEffect, useState } from "react";
import { NoteListView } from "./NoteListView";
import { IClient } from "../interface/Client";
import { DocumentEntity } from "../interface/DataEntity";
import { Box, Typography } from "@mui/material";
import { i18n } from "../internationnalization/utils";
import { useBindableProperty } from "../hooks/hooks";
import { getAuthorization } from "../utils/getAuthorization";
export const RecentNoteList: React.FC<{ client: IClient }> = ({ client }) => {
  const [offlineDocList, setOfflineDocList] = useState<DocumentEntity[] | null>(
    null,
  );

  const offlineMode = useBindableProperty(client.offlineMode);
  const userId = offlineMode ? undefined : getAuthorization()?.payload.userId;

  const updateOfflineList = useCallback(async () => {
    const online = !offlineMode && userId;

    const offlineNotes = await client.db.getDocumentList(
      false,
      "last_modify_date",
      "prev",
      10,
    );

    const myOfflineList = online
      ? offlineNotes.filter(
          (f) => f.user_id === userId || f.user_id === "offline",
        )
      : offlineNotes;

    setOfflineDocList(myOfflineList);
  }, [client, offlineMode, userId]);

  useEffect(() => {
    updateOfflineList();
  }, []);

  return (
    <Box>
      {offlineDocList?.length ? (
        <Box>
          <Typography variant="h6">{i18n("recent_notes")}</Typography>
        </Box>
      ) : null}

      <NoteListView
        client={client}
        onlineDocList={null}
        offlineDocList={offlineDocList}
        onRequestUpdateList={updateOfflineList}
        sortByCreateDate={false}
      />
    </Box>
  );
};
