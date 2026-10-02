import {
  Avatar,
  Box,
  Container,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  SwipeableDrawer,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Tooltip,
} from "@mui/material";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAllBindableProperties,
  useBindableProperty,
  useLanguage,
} from "../../hooks/hooks";
import { IClient } from "../../interface/Client";
import { getAuthorization } from "../../utils/getAuthorization";
import { gotoLogin } from "../../utils/gotoLogin";
import { hashColorWitchCache } from "../../utils/utils";
import { User } from "./User";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import LockResetRoundedIcon from "@mui/icons-material/LockResetRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import PaletteRoundedIcon from "@mui/icons-material/PaletteRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import type { SvgIconComponent } from "@mui/icons-material";
import type { Theme } from "@mui/material";
import { GlobalSnackBar } from "../common/GlobalSnackBar";
import {
  i18n,
  setLanguage,
  supportedLanguages,
  type LanType,
} from "../../internationnalization/utils";
import Format from "string-format";
import PackageJson from "../../../package.json";
import { ExportItem } from "./import-export/export";
import { ImportItem } from "./import-export/import";
import { SyncAllItem } from "./import-export/SyncAllItem";
import { isDev, isNative } from "../../const/host";
import { askDialog } from "../common/AskDialog";
import { ChangePasswordDialog } from "../common/ChangePasswordDialog";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { SettingKeys } from "../../Setting";

const settingIcons: Record<SettingKeys, SvgIconComponent> = {
  offlineByDefault: CloudOffRoundedIcon,
  autoSaveToLocal: SaveRoundedIcon,
  openLastDocWhenStart: HistoryRoundedIcon,
};

const restartOnlySettings: SettingKeys[] = ["offlineByDefault"];

const settingToggleSx = {
  "& .MuiToggleButton-root": {
    textTransform: "none",
    "&.Mui-selected": {
      color: (theme: Theme) =>
        theme.palette.mode === "light"
          ? theme.palette.primary.dark
          : theme.palette.primary.main,
    },
  },
};

const flagToggleSx = {
  px: 1,
  py: 0,
  minHeight: 28,
  fontSize: 16,
  lineHeight: 1,
  "&:not(.Mui-selected)": { opacity: 0.4 },
};

export const Header: React.FC<{ client: IClient }> = ({ client }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [clearCachesOpen, setClearCachesOpen] = useState(false);
  const offlineMode = useBindableProperty(client.offlineMode);
  const themeColorSetting = useBindableProperty(
    client.setting.colorTheme.themeColorSetting,
  );

  const headerView = useBindableProperty(client.headerView);
  const language = useLanguage();
  const navigate = useNavigate();
  const auth = getAuthorization();
  const userName = auth?.payload.userId;
  const userColor = userName ? hashColorWitchCache(userName) : undefined;

  const settingPairs = Object.entries(client.setting.properties);
  const settingNames = settingPairs.map((p) => p[0]) as SettingKeys[];
  const settings = useAllBindableProperties(...settingPairs.map((p) => p[1]));

  const closeMenu = () => setMenuOpen(false);

  const clearCaches = async () => {
    const keys = await caches.keys();
    for (let i = 0; i < keys.length; i++) {
      await caches.delete(keys[i]);
    }
    GlobalSnackBar.getInstance().pushMessage(i18n("caches_cleared"));
  };

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
            <Box
              sx={{
                width: 320,
                maxWidth: "100vw",
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1.5,
                  flexShrink: 0,
                }}
              >
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    backgroundColor: userColor
                      ? `rgb(${userColor.r}, ${userColor.g}, ${userColor.b})`
                      : undefined,
                  }}
                >
                  {userName?.[0]?.toUpperCase()}
                </Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  {userName && (
                    <Typography variant="subtitle1" noWrap>
                      {userName}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    color={offlineMode ? "warning.main" : "text.secondary"}
                    sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                  >
                    <CloudIcon sx={{ fontSize: 14 }} />
                    {offlineMode
                      ? i18n("offline_mode_title")
                      : auth
                        ? i18n("online_mode_title")
                        : i18n("you_are_not_signed_in")}
                  </Typography>
                </Box>
              </Box>
              <Divider />
              <List dense sx={{ py: 0, flexGrow: 1, overflowY: "auto" }}>
                <ListSubheader disableSticky>
                  {i18n("setting_section_preferences")}
                </ListSubheader>
                <ListItem
                  dense
                  secondaryAction={
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={themeColorSetting}
                      onChange={(_, newSetting: string) => {
                        if (newSetting === "light" || newSetting === "dark") {
                          client.setting.colorTheme.themeColorSetting.value =
                            newSetting;
                        } else {
                          client.setting.colorTheme.themeColorSetting.value =
                            "auto";
                        }
                      }}
                      aria-label={i18n("color_mode")}
                      sx={settingToggleSx}
                    >
                      <ToggleButton value="auto" sx={{ px: 1, py: 0.25 }}>
                        {i18n("color_mode_auto")}
                      </ToggleButton>
                      <ToggleButton value="light" sx={{ px: 1, py: 0.25 }}>
                        {i18n("color_mode_light")}
                      </ToggleButton>
                      <ToggleButton value="dark" sx={{ px: 1, py: 0.25 }}>
                        {i18n("color_mode_dark")}
                      </ToggleButton>
                    </ToggleButtonGroup>
                  }
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <PaletteRoundedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={i18n("color_mode")} />
                </ListItem>

                <ListItem
                  dense
                  secondaryAction={
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={language}
                      onChange={(_, next: LanType | null) => {
                        if (next) {
                          setLanguage(next);
                        }
                      }}
                      aria-label={i18n("language")}
                    >
                      {supportedLanguages.map(({ code, flag, label }) => (
                        <Tooltip key={code} title={label}>
                          <ToggleButton
                            value={code}
                            aria-label={label}
                            sx={flagToggleSx}
                          >
                            {flag}
                          </ToggleButton>
                        </Tooltip>
                      ))}
                    </ToggleButtonGroup>
                  }
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <TranslateRoundedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={i18n("language")} />
                </ListItem>

                {settings.map((value, i) => {
                  const name = settingNames[i];
                  const SettingIcon = settingIcons[name];
                  return (
                    <ListItem
                      key={name}
                      dense
                      secondaryAction={
                        <Switch
                          size="small"
                          checked={value}
                          inputProps={{ "aria-label": i18n(`setting_${name}`) }}
                          onChange={(_e, checked) => {
                            client.setting.properties[name].value = checked;
                          }}
                        />
                      }
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <SettingIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={i18n(`setting_${name}`)}
                        secondary={
                          restartOnlySettings.includes(name)
                            ? i18n("setting_restart_hint")
                            : undefined
                        }
                      />
                    </ListItem>
                  );
                })}

                <Divider component="li" sx={{ my: 1 }} />
                <ListSubheader disableSticky>
                  {i18n("setting_section_account")}
                </ListSubheader>
                {auth && (
                  <ListItemButton
                    dense
                    onClick={() => {
                      closeMenu();
                      setChangePasswordOpen(true);
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <LockResetRoundedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={i18n("change_password")} />
                  </ListItemButton>
                )}
                <ListItemButton
                  dense
                  onClick={() => {
                    closeMenu();
                    navigate("/");
                    client.docListUpdateIndex.value += 1;
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <HomeRoundedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={i18n("home_page")} />
                </ListItemButton>
                <ListItemButton
                  dense
                  onClick={() => {
                    closeMenu();
                    gotoLogin(navigate);
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {auth ? (
                      <LogoutRoundedIcon fontSize="small" />
                    ) : (
                      <LoginRoundedIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={auth ? i18n("sign_out") : i18n("sign_in")}
                  />
                </ListItemButton>

                <Divider component="li" sx={{ my: 1 }} />
                <ListSubheader disableSticky>
                  {i18n("setting_section_data")}
                </ListSubheader>
                <ExportItem client={client} />
                <ImportItem client={client} onFinished={closeMenu} />
                <SyncAllItem client={client} />
                <ListItemButton dense onClick={() => setClearCachesOpen(true)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <DeleteSweepRoundedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={i18n("clear_caches")} />
                </ListItemButton>
                {(isNative || isDev()) && (
                  <ListItemButton
                    dense
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
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <DnsRoundedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={i18n("host_setting")} />
                  </ListItemButton>
                )}
              </List>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ px: 2, py: 1.5, flexShrink: 0 }}
              >
                {Format(i18n("version_of_app"), {
                  version: PackageJson.version ?? "",
                })}
              </Typography>
            </Box>
          </SwipeableDrawer>
          <ChangePasswordDialog
            open={changePasswordOpen}
            onClose={() => {
              setChangePasswordOpen(false);
            }}
          />
          <ConfirmDialog
            open={clearCachesOpen}
            title={i18n("clear_caches_confirm_title")}
            content={i18n("clear_caches_confirm_content")}
            confirmText={i18n("clear_caches")}
            confirmColor="warning"
            onConfirm={() => {
              setClearCachesOpen(false);
              void clearCaches();
            }}
            onClose={() => {
              setClearCachesOpen(false);
            }}
          />
        </Container>
      </Box>
    </Box>
  );
};
