import { Box, Stack, TextField } from "@mui/material";
import { Container } from "@mui/system";
import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHttpRequest } from "../../hooks/hooks";
import { IClient } from "../../interface/Client";
import { gotoLogin } from "../../utils/gotoLogin";
import { GlobalSnackBar } from "../common/GlobalSnackBar";
import { LoadingButton } from "../common/LoadingButton";
import { i18n } from "../../internationnalization/utils";
export const SignUpPage: React.FC<{ client: IClient }> = () => {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const httpRequest = useHttpRequest();
  const navigate = useNavigate();

  const signUp = useCallback(async () => {
    setLoading(true);

    try {
      if (password !== password2) {
        throw new Error(i18n("password_not_correct"));
      }

      const response = await httpRequest("signUp", { userName, password });
      if (response?.success) {
        GlobalSnackBar.getInstance().pushMessage(
          i18n("sign_up_success"),
          "success",
        );
        gotoLogin(navigate);
      } else {
        throw new Error(i18n("sign_up_failed"));
      }
    } catch (e) {
      if (e instanceof Error) {
        GlobalSnackBar.getInstance().pushMessage(e.message, "error");
      }
    }
    setLoading(false);
  }, [userName, password, password2, setLoading]);

  return (
    <Container maxWidth="sm" fixed>
      <Stack spacing="18px">
        <Box>{i18n("sign_up")}</Box>
        <TextField
          fullWidth
          required
          label={i18n("user_name")}
          value={userName}
          autoComplete="false"
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
          autoComplete="false"
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <TextField
          type="password"
          fullWidth
          required
          label={i18n("confirm_password")}
          value={password2}
          autoComplete="false"
          onChange={(e) => {
            setPassword2(e.target.value);
          }}
        />
        <LoadingButton
          loading={loading}
          variant="contained"
          onClick={() => {
            signUp();
          }}
        >
          {i18n("sign_up")}
        </LoadingButton>
      </Stack>
    </Container>
  );
};
