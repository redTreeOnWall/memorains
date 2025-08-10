import { Button, Box, Container, Typography } from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import Format from "string-format";
import { IClient } from "../../interface/Client";
import { i18n } from "../../internationnalization/utils";
import { getAuthorization } from "../../utils/getAuthorization";
import { gotoLogin } from "../../utils/gotoLogin";
import PackageJson from "../../../package.json";
import { RecentNoteList } from "../../components/RecentNoteList";

const HomePage: React.FC<{ client: IClient }> = ({ client }) => {
  const navigate = useNavigate();
  const userId = getAuthorization()?.payload.userId;

  const title = userId
    ? Format(i18n("welcome_user"), { userId })
    : i18n("welcome");

  // useEffect(() => {
  //   console.log("no navigate:");
  //   if (userId) {
  //     navigate("/my-doc");
  //     return;
  //   }
  // }, [userId, navigate]);

  return (
    <Container>
      <Box>
        <Box
          sx={{
            position: "fixed",
            textAlign: "center",
            width: "100%",
            left: "0",
            bottom: "16px",
            fontSize: "12px",
          }}
        >
          Version: {PackageJson.version}
        </Box>
        <Typography variant="h4">{title}</Typography>
      </Box>
      {!userId && (
        <Box>
          <Button
            sx={{
              margin: (theme) => theme.spacing(),
            }}
            variant="contained"
            onClick={() => {
              client.offlineMode.value = true;
              navigate("/my-doc");
            }}
          >
            {i18n("use_in_offline")}
          </Button>
          <Button
            sx={{
              margin: (theme) => theme.spacing(),
            }}
            variant="outlined"
            onClick={() => {
              gotoLogin(navigate);
            }}
          >
            {i18n("sign_in")}
          </Button>
          <Button
            sx={{
              margin: (theme) => theme.spacing(),
            }}
            onClick={() => {
              navigate("/sign-up");
            }}
            variant="outlined"
          >
            {i18n("sign_up")}
          </Button>
        </Box>
      )}

      {userId && (
        <Box>
          <Button
            sx={{
              margin: (theme) => theme.spacing(),
            }}
            variant="contained"
            onClick={() => {
              navigate("/my-doc");
            }}
          >
            {i18n("my_notes")}
          </Button>
        </Box>
      )}

      <RecentNoteList client={client} />
    </Container>
  );
};

export default HomePage;
