import {
  ListItem,
  ListItemButton,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  IconButton,
} from "@mui/material";
import React, { useState } from "react";
import Format from "string-format";
import type { IClient } from "../../../interface/Client";
import { DocumentEntity } from "../../../interface/DataEntity";
import { i18n } from "../../../internationnalization/utils";
import { useHttpRequest } from "../../../hooks/hooks";
import { syncSingleDoc } from "../../../utils/docData";
import { getAuthorization } from "../../../utils/getAuthorization";
import { DocListFilterPanel } from "./DocListFilterPanel";
import { GlobalSnackBar } from "../../common/GlobalSnackBar";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import CloseIcon from "@mui/icons-material/Close";
import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";

export const SyncAllItem: React.FC<{ client: IClient }> = ({ client }) => {
  const [docList, setDocList] = useState<DocumentEntity[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncResults, setSyncResults] = useState<{
    success: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const httpRequest = useHttpRequest();

  const handleOpen = async () => {
    const offlineMode = client.offlineMode.value;
    if (offlineMode) {
      GlobalSnackBar.getInstance().pushMessage(
        i18n("sync_all_offline_warning"),
        "warning",
      );
      return;
    }

    // Fetch both local and remote doc lists
    const userId = getAuthorization()?.payload.userId;

    const [localDocs, remoteRes] = await Promise.all([
      client.db.getDocumentList(true),
      httpRequest("docList", undefined),
    ]);

    const remoteDocList = remoteRes?.data?.docList ?? [];

    // Merge into a single list, preferring local data for state
    const mergedMap = new Map<string, DocumentEntity>();

    // Add local docs
    for (const doc of localDocs) {
      mergedMap.set(doc.id, doc);
    }

    // Add remote docs (only metadata, no state)
    for (const remote of remoteDocList) {
      if (remote.user_id !== userId && remote.user_id !== "offline") {
        continue;
      }
      const existing = mergedMap.get(remote.id);
      if (existing) {
        // Already have local; keep local but update metadata fields
        existing.title = existing.title || remote.title;
        existing.user_id = existing.user_id || remote.user_id;
        existing.create_date = existing.create_date || remote.create_date;
        existing.last_modify_date =
          existing.last_modify_date || remote.last_modify_date;
        existing.commit_id = remote.commit_id ?? existing.commit_id;
        existing.doc_type = remote.doc_type ?? existing.doc_type;
        existing.encrypt_salt = existing.encrypt_salt ?? remote.encrypt_salt;
      } else {
        // Remote-only doc (no state)
        mergedMap.set(remote.id, {
          id: remote.id,
          title: remote.title,
          user_id: remote.user_id,
          create_date: remote.create_date,
          last_modify_date: remote.last_modify_date,
          state: null,
          is_public: 0,
          commit_id: remote.commit_id,
          doc_type: remote.doc_type ?? 0,
          encrypt_salt: remote.encrypt_salt,
        });
      }
    }

    const mergedList = Array.from(mergedMap.values());
    setDocList(mergedList);
    setFilterPanelOpen(true);
  };

  const handleConfirmSync = async (selectedDocs: DocumentEntity[]) => {
    setFilterPanelOpen(false);
    setSyncing(true);
    setSyncTotal(selectedDocs.length);
    setSyncProgress(0);
    setSyncResults(null);

    const results = { success: 0, skipped: 0, failed: 0 };

    for (let i = 0; i < selectedDocs.length; i++) {
      const doc = selectedDocs[i];
      setSyncProgress(i + 1);

      try {
        const status = await syncSingleDoc(doc.id, client, httpRequest);
        results[status] += 1;
      } catch (e) {
        console.error(`Sync failed for doc "${doc.title}":`, e);
        results.failed += 1;
      }
    }

    setSyncResults(results);
    setSyncing(false);

    // Refresh doc list
    client.docListUpdateIndex.value += 1;

    const totalSynced = results.success;
    const totalSkipped = results.skipped;
    const totalFailed = results.failed;

    if (totalFailed > 0) {
      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("sync_all_result_with_failures"), {
          success: `${totalSynced}`,
          skipped: `${totalSkipped}`,
          failed: `${totalFailed}`,
        }),
        totalFailed > 0 ? "warning" : "success",
      );
    } else if (totalSkipped > 0) {
      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("sync_all_result_with_skipped"), {
          success: `${totalSynced}`,
          skipped: `${totalSkipped}`,
        }),
        "success",
      );
    } else {
      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("sync_all_result"), {
          total: `${totalSynced}`,
        }),
        "success",
      );
    }
  };

  return (
    <>
      <ListItem>
        <ListItemButton onClick={handleOpen}>
          <SyncRoundedIcon sx={{ mr: 1 }} />
          {i18n("sync_all")}
        </ListItemButton>
      </ListItem>

      <DocListFilterPanel
        docList={docList}
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        onConfirm={handleConfirmSync}
      />

      {/* Progress Dialog */}
      <Dialog open={syncing} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">
              {i18n("sync_all_progress_title")}
            </Typography>
            <IconButton disabled size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {Format(i18n("sync_all_progress"), {
                current: `${syncProgress}`,
                total: `${syncTotal}`,
              })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={syncTotal > 0 ? (syncProgress / syncTotal) * 100 : 0}
            />
          </Box>
        </DialogContent>
      </Dialog>

      {/* Results Dialog */}
      <Dialog
        open={syncResults !== null}
        onClose={() => setSyncResults(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">
              {i18n("sync_all_result_title")}
            </Typography>
            <IconButton onClick={() => setSyncResults(null)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {syncResults && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CloudDoneRoundedIcon color="success" />
                <Typography>
                  {Format(i18n("sync_all_success_count"), {
                    count: `${syncResults.success}`,
                  })}
                </Typography>
              </Box>
              {syncResults.skipped > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <KeyRoundedIcon color="warning" />
                  <Typography>
                    {Format(i18n("sync_all_skipped_count"), {
                      count: `${syncResults.skipped}`,
                    })}
                  </Typography>
                </Box>
              )}
              {syncResults.failed > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <SaveRoundedIcon color="error" />
                  <Typography>
                    {Format(i18n("sync_all_failed_count"), {
                      count: `${syncResults.failed}`,
                    })}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncResults(null)} variant="contained">
            {i18n("confirm_button")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
