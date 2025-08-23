import {
  Avatar,
  Box,
  Container,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  SwipeableDrawer,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAllBindableProperties,
  useBindableProperty,
} from "../../hooks/hooks";
import { IClient } from "../../interface/Client";
import { getAuthorization } from "../../utils/getAuthorization";
import { gotoLogin } from "../../utils/gotoLogin";
import { User } from "./User";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import { GlobalSnackBar } from "../common/GlobalSnackBar";
import { Space } from "../common/Space";
import { i18n } from "../../internationnalization/utils";
import Format from "string-format";
import PackageJson from "../../../package.json";
import { ExportItem } from "./import-export/export";
import { ImportItem } from "./import-export/import";
import { isDev, isElectron } from "../../const/host";
import { askDialog } from "../common/AskDialog";
import type { Setting, SettingKeys } from "../../Setting";

export const Header: React.FC<{ client: IClient }> = ({ client }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const offlineMode = useBindableProperty(client.offlineMode);
  const themeColorSetting = useBindableProperty(
    client.setting.colorTheme.themeColorSetting,
  );

  const headerView = useBindableProperty(client.headerView);
  const navigate = useNavigate();
  const auth = getAuthorization();

  const settingPairs = Object.entries(client.setting.properties);
  const settingNames = settingPairs.map((p) => p[0]) as SettingKeys[];
  const settings = useAllBindableProperties(...settingPairs.map((p) => p[1]));

  const height = 50;
  const CloudIcon = offlineMode ? CloudOffRoundedIcon : CloudQueueRoundedIcon;
  return (
    <Box
      sx={{
        height: (t) => `calc( ${height}px + ${t.spacing()})`,
        width: "100%",
      }}
    >
      <Box
        sx={{
          position: "fixed",
          borderBottom: "1px solid",
          borderColor: (theme) => theme.palette.grey.A200,
          top: "0",
          left: "0",
          width: "100%",
          zIndex: 999,
          height: `${height}px`,
          lineHeight: `${height}px`,
          bgcolor: "background.paper",
        }}
      >
        <Container maxWidth="md">
          <Tooltip title={i18n("home_page")}>
            <IconButton
              onClick={() => {
                // navigate("/my-doc");
                navigate("/");
                client.docListUpdateIndex.value += 1;
              }}
            >
              <HomeRoundedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={
              offlineMode
                ? i18n("you_are_in_the_offline_mode")
                : i18n("you_are_in_the_online_mode")
            }
          >
            <IconButton
              onClick={() => {
                if (!offlineMode) {
                  client.offlineMode.value = true;
                }
                gotoLogin(navigate);
              }}
            >
              <CloudIcon
                sx={
                  offlineMode
                    ? { color: (t) => t.palette.warning.main }
                    : undefined
                }
              />
            </IconButton>
          </Tooltip>
          <Box
            sx={{
              display: "inline-flex",
              padding: "8px",
              justifyContent: "center",
              height: `${height}px`,
              position: "absolute",
            }}
          >
            {headerView}
          </Box>
          <User
            userName={auth?.payload.userId}
            onClick={() => {
              setMenuOpen(!menuOpen);
            }}
          />
          <SwipeableDrawer
            anchor="right"
            open={menuOpen}
            onClose={() => {
              setMenuOpen(false);
            }}
            onOpen={() => {
              setMenuOpen(true);
            }}
          >
            <Box sx={{ width: "460px", maxWidth: "100vw" }}>
              <List>
                <ListItem>
                  <Avatar
                    sx={{
                      width: 36,
                      height: 36,
                    }}
                  ></Avatar>
                  <Box margin={(the) => the.spacing()}>
                    {auth?.payload.userId}
                  </Box>
                </ListItem>

                <ListItem>
                  <ListItemButton>
                    {i18n("color_mode")} <Space />
                    <ToggleButtonGroup
                      color="primary"
                      value={themeColorSetting}
                      exclusive
                      onChange={(_, newSetting: string) => {
                        if (newSetting === "light" || newSetting === "dark") {
                          client.setting.colorTheme.themeColorSetting.value =
                            newSetting;
                        } else {
                          client.setting.colorTheme.themeColorSetting.value =
                            "auto";
                        }
                      }}
                      aria-label="Platform"
                    >
                      <ToggleButton value="auto">
                        {i18n("color_mode_auto")}
                      </ToggleButton>
                      <ToggleButton value="light">
                        {i18n("color_mode_light")}
                      </ToggleButton>
                      <ToggleButton value="dark">
                        {i18n("color_mode_dark")}
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </ListItemButton>
                </ListItem>

                {settings.map((value, i) => {
                  const name = settingNames[i];
                  return (
                    <ListItem key={name}>
                      <ListItemButton>
                        {i18n(`setting_${name}`)}
                        <Switch
                          checked={value}
                          onChange={(_e, checked) => {
                            client.setting.properties[name].value = checked;
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}

                <ListItem>
                  <ListItemButton
                    onClick={(e) => {
                      gotoLogin(navigate);
                      setMenuOpen(false);
                      e.stopPropagation();
                    }}
                  >
                    {i18n("sign_in")}
                  </ListItemButton>
                </ListItem>

                <ListItem>
                  <ListItemButton
                    onClick={() => {
                      navigate("/");
                      setMenuOpen(false);
                    }}
                  >
                    {i18n("home_page")}
                  </ListItemButton>
                </ListItem>

                <ListItem>
                  <ListItemButton>{i18n("setting")}</ListItemButton>
                </ListItem>

                {(isElectron || isDev()) && (
                  <ListItem>
                    <ListItemButton
                      onClick={async () => {
                        const res = await askDialog.openTextInput({
                          title: i18n("host_setting"),
                          label: i18n("host_setting_label"),
                          buttonText: i18n("confirm_button"),
                          // initText: getAppHost(),
                        });

                        if (res.type === "confirm") {
                          localStorage.setItem("memo_note_host", res.text);
                        }
                      }}
                    >
                      {i18n("host_setting")}
                    </ListItemButton>
                  </ListItem>
                )}

                <ListItem>
                  <ListItemButton
                    onClick={async () => {
                      const keys = await caches.keys();
                      for (let i = 0; i < keys.length; i++) {
                        await caches.delete(keys[i]);
                      }
                      GlobalSnackBar.getInstance().pushMessage(
                        i18n("caches_cleared"),
                      );
                    }}
                  >
                    {i18n("clear_caches")}
                  </ListItemButton>
                </ListItem>

                <ListItem>
                  <ListItemButton>
                    {Format(i18n("version_of_app"), {
                      version: PackageJson.version ?? "",
                    })}
                  </ListItemButton>
                </ListItem>

                <ExportItem client={client} />
                <ImportItem
                  client={client}
                  onFinished={() => {
                    setMenuOpen(false);
                    client.docListUpdateIndex.value += 1;
                  }}
                />
              </List>
            </Box>
          </SwipeableDrawer>
        </Container>
      </Box>
    </Box>
  );
};
