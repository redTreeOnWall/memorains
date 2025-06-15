import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import { i18n } from "../internationnalization/utils";
import { Space } from "./common/Space";
import {
  awaitTime,
  deriveAESKeyToBase64,
  encryptData,
  generateSalt,
  importAES128KeyFromBase64,
  randomInt,
  setCryptoKeyToLocal,
  uuid,
} from "../utils/utils";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import moment from "moment";
import { DocType, DocumentEntity } from "../interface/DataEntity";
import { GlobalSnackBar } from "./common/GlobalSnackBar";
import { useHttpRequest } from "../hooks/hooks";
import { IClient } from "../interface/Client";
import { LoadingButton } from "./common/LoadingButton";
import { getAuthorization } from "../utils/getAuthorization";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import { Base64 } from "js-base64";
import Format from "string-format";

const getDefaultDocName = () => {
  const date = new Date();
  const createTime = moment(date).format("YYYY-MM-DD HH:mm:ss");
  return Format(i18n("default_new_doc_name"), { createTime });
};

export const createDocument = async (
  docType: DocType,
  client: IClient,
  httpRequest: ReturnType<typeof useHttpRequest>,
  docName?: string,
  encryptSalt?: string,
  state: ArrayBuffer | null = null,
) => {
  const offlineMode = client.offlineMode.value;
  const userId = offlineMode ? undefined : getAuthorization()?.payload.userId;
  const date = new Date();
  const createTime = moment(date).format("YYYY-MM-DD HH:mm:ss");
  const title = docName ?? getDefaultDocName();
  const id = uuid();

  const newDoc: DocumentEntity = {
    id,
    title,
    user_id: userId ?? "offline",
    create_date: createTime,
    last_modify_date: createTime,
    state: state ?? new ArrayBuffer(0),
    is_public: 0,
    commit_id: randomInt(),
    doc_type: docType,
    encrypt_salt: encryptSalt,
  };

  const createOnline = async () => {
    const state = Base64.fromUint8Array(new Uint8Array(newDoc.state!));
    const result = await httpRequest("createDoc", {
      docType,
      newDoc: { ...newDoc, state },
    });
    await awaitTime(500);
    if (result?.success) {
      GlobalSnackBar.getInstance().pushMessage(
        i18n("new_document_created"),
        "success",
      );
      return result.data.newDocId;
    } else {
      GlobalSnackBar.getInstance().pushMessage(
        i18n("new_document_created_failed"),
        "error",
      );
      return null;
    }
  };

  const createOffline = async () => {
    client.db.createOrUpdateDoc(newDoc);
  };

  if (offlineMode) {
    // GlobalSnackBar.getInstance().pushMessage(
    //   `Please sign in and create document.`,
    //   "error"
    // );
    // TODO create local document
    await createOffline();

    return id;
  } else {
    return await createOnline();
  }
};

export const CreateDoc: React.FC<{
  client: IClient;
  onCreated: () => void;
}> = ({ client, onCreated }) => {
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [docType, setDocType] = useState<DocType>(DocType.text);
  const [encrypt, setEncrypt] = useState(false);
  const [saveSecret, setSaveSecret] = useState(false);
  const [docName, setDocName] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const httpRequest = useHttpRequest();

  const onClose = () => {
    setShowDialog(false);
  };

  useEffect(() => {
    // init
    if (showDialog) {
      setDocName(getDefaultDocName());
      setDocType(DocType.text);
      setEncrypt(false);
      setSaveSecret(false);
      // setSecret(generateSalt(32));
      setSecret("");
    }
  }, [showDialog]);

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        onClick={() => {
          setShowDialog(true);
        }}
      >
        + <KeyRoundedIcon />
      </Button>
      <Dialog open={showDialog} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle> {i18n("create_new_doc")}</DialogTitle>
        <DialogContent>
          <Space />
          <TextField
            fullWidth
            required
            label={i18n("create_new_doc_name")}
            value={docName}
            onChange={(e) => {
              setDocName(e.target.value);
            }}
          />
          <Box
            sx={{
              marginTop: "16px",
            }}
          >
            <FormControl fullWidth>
              <InputLabel id="doc-type-select-label">
                {i18n("create_new_doc_type")}
              </InputLabel>
              <Select
                labelId="doc-type-select-label"
                id="doc=type-select"
                value={docType}
                label={i18n("create_new_doc_type")}
                sx={{ height: "64px", lineHeight: "64px" }}
                onChange={(e) => {
                  // console.log("selected:", e.target.value);
                  const val = e.target.value;
                  setDocType(typeof val === "number" ? val : DocType.text);
                }}
              >
                <MenuItem value={DocType.text}>
                  <ArticleRoundedIcon /> {i18n("doc_type_article")}
                </MenuItem>
                <MenuItem value={DocType.canvas}>
                  <ColorLensRoundedIcon /> {i18n("doc_type_canvas")}
                </MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box>
            {i18n("create_new_doc_ask_encrypt")} <Space />
            <Switch
              checked={encrypt}
              onChange={(_, checked) => {
                setEncrypt(checked);
              }}
            />
          </Box>
          {encrypt && (
            <Box>
              <TextField
                disabled={!encrypt}
                fullWidth
                type="password"
                autoComplete="one-time-code"
                value={secret}
                label={i18n("create_new_doc_ask_input_password")}
                onChange={(e) => {
                  setSecret(e.target.value);
                }}
              />
              <Box>
                {i18n("create_new_doc_ask_save_password")}
                <Switch
                  disabled={!encrypt}
                  checked={saveSecret}
                  onChange={(_, checked) => {
                    setSaveSecret(checked);
                  }}
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{i18n("cancel_button")}</Button>
          <LoadingButton
            variant="contained"
            onClick={async () => {
              const password = secret;
              let encryptSalt: string | undefined = undefined;
              let cryptoKey: string | undefined = undefined;
              let state = new ArrayBuffer(0);
              if (encrypt) {
                encryptSalt = generateSalt(16);
                cryptoKey = await deriveAESKeyToBase64(password, encryptSalt);
                const cryptoKeyObj = await importAES128KeyFromBase64(cryptoKey);
                state = await encryptData(state, cryptoKeyObj);
              }
              setLoading(true);
              const id = await createDocument(
                docType,
                client,
                httpRequest,
                docName ? docName : undefined,
                encryptSalt,
                state,
              );

              if (id && saveSecret && cryptoKey) {
                // TODO encrypt and save into indexedDB
                await setCryptoKeyToLocal(id, cryptoKey);
              }
              setLoading(false);
              onClose();
              onCreated();
            }}
            loading={loading}
          >
            {i18n("confirm_button")}
          </LoadingButton>
        </DialogActions>
      </Dialog>
    </>
  );
};
