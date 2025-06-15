import { Box, Button, Stack, TextField } from "@mui/material";
import { Container } from "@mui/system";
import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHttpRequest } from "../../hooks/hooks";
import { IClient } from "../../interface/Client";
import { saveJwt } from "../../utils/getAuthorization";
import { GlobalSnackBar } from "../common/GlobalSnackBar";
import { LoadingButton } from "../common/LoadingButton";
import { i18n } from "../../internationnalization/utils";
import Format from "string-format";
export const LoginPage: React.FC<{ client: IClient }> = ({ client }) => {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const request = useHttpRequest();

  const [loading, setLoading] = useState(false);

  const login = useCallback(async () => {
    setLoading(true);
    const result = await request("signIn", { userName, password });
    setLoading(false);

    if (result?.success && result?.data?.authorization) {
      saveJwt(result.data.authorization);
      GlobalSnackBar.getInstance().pushMessage(
        i18n("success_sign_in"),
        "success",
      );
      client.offlineMode.value = false;
      navigate("/");
    } else {
      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("failed_to_sign_in"), {
          errorCode: result?.code ?? "",
          errorMessage: result?.errorMessage ?? "",
        }),
        "error",
      );
    }
  }, [setLoading, request, password, userName]);

  return (
    <Container maxWidth="sm" fixed>
      {/* TODO header */}
      <Stack spacing="18px">
        <Box margin="auto">{i18n("sign_in")}</Box>
        <TextField
          fullWidth
          required
          label={i18n("user_name")}
          value={userName}
          onChange={(e) => {
            setUserName(e.target.value);
          }}
        />
        <TextField
          type="password"
          fullWidth
          required
          label={i18n("password")}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <LoadingButton
          loading={loading}
          variant="contained"
          onClick={() => {
            login();
          }}
        >
          {i18n("sign_in")}
        </LoadingButton>
        <Button
          variant="outlined"
          onClick={() => {
            client.offlineMode.value = true;
            navigate("/my-doc");
          }}
        >
          {i18n("use_in_offline")}
        </Button>
        <Button
          variant="text"
          onClick={() => {
            navigate("/sign-up");
          }}
        >
          {i18n("sign_up")}
        </Button>
      </Stack>
    </Container>
  );
};
