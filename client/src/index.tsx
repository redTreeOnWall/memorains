import { isElectron } from "./const/host";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { GlobalSnackBarComponent } from "./components/common/GlobalSnackBar";
import { Header } from "./components/header";
import { LoginPage } from "./components/login";
import { SignUpPage } from "./components/sign-up";
import { IndexedDB } from "./DB/IndexedDB";
import { MyDocs } from "./components/MyDocs";
import "./index.css";
import { BindableProperty } from "./utils/BindableProperty";
import { useBindableProperty } from "./hooks/hooks";
import { QuillEditor } from "./editor/QuillEditor";
import { TodoListEditor } from "./editor/TodoListEditor";

import { ExcalidrawCanvas } from "./components/canvas/ExcalidrawCanvas";
import { AskDialogComponent } from "./components/common/AskDialog";
import HomePage from "./pages/home/HomePage";
import { Setting } from "./Setting";
import { LocalStorageProperty } from "./utils/LocalStorageProperty";
import { i18n } from "./internationnalization/utils";

const themeColorSettingKey = "themeColorSettingKey";

// Component to handle dynamic page titles
const TitleHandler: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;

    // Default title
    let title: string = i18n("app_name");

    // Route-based titles
    if (path === "/" || path === "") {
      title = i18n("app_name");
    } else if (path === "/login") {
      title = `${i18n("sign_in")} - ${i18n("app_name")}`;
    } else if (path === "/sign-up") {
      title = `${i18n("sign_up")} - ${i18n("app_name")}`;
    } else if (path === "/my-doc") {
      title = `${i18n("my_notes")} - ${i18n("app_name")}`;
    } else if (path === "/document" || path === "/canvas" || path === "/todo") {
      // These editors will handle their own titles via CommonEditor
      // Keep default title until document info is loaded
      title = i18n("app_name");
    } else {
      title = i18n("app_name");
    }

    document.title = title;
  }, [location]);

  return null;
};

export class Client {
  setting = new Setting();

  offlineMode = new BindableProperty(false);

  db: IndexedDB;

  docListUpdateIndex = new BindableProperty(0);

  headerView = new BindableProperty<React.ReactElement | null>(null);

  sideListStatus = new LocalStorageProperty<"close" | "open">(
    "memorains_side_list_status",
    "close",
  );

  constructor() {
    this.db = new IndexedDB();

    this.initOfflineMode();
    this.initColorTheme();
  }

  lastDocHaveBeenOpen = false;

  private initOfflineMode() {
    if (this.setting.properties.offlineByDefault.value) {
      console.log("hide ....");
      this.offlineMode.value = true;
      return;
    }
    const online = window.navigator.onLine;
    this.offlineMode.value = online === false;

    window.addEventListener("offline", () => {
      this.offlineMode.value = true;
    });

    window.addEventListener("online", () => {
      this.offlineMode.value = false;
    });
  }

  private initColorTheme() {
    const initDarkModeSetting =
      (localStorage.getItem(themeColorSettingKey) as
        | "dark"
        | "light"
        | "auto"
        | undefined
        | null) ?? "auto";

    this.setting.colorTheme.themeColorSetting.value = initDarkModeSetting;

    const updateDarkModeStateByMatchLight = (matchLight: boolean) => {
      this.setting.colorTheme.systemLightColor.value = matchLight;
    };

    const themeMedia = window.matchMedia("(prefers-color-scheme: light)");
    updateDarkModeStateByMatchLight(themeMedia.matches);
    themeMedia.onchange = (e) => {
      updateDarkModeStateByMatchLight(e.matches);
    };

    const updateDarkMode = () => {
      if (this.setting.colorTheme.themeColorSetting.value === "auto") {
        this.setting.colorTheme.resultThemeColor.value = this.setting.colorTheme
          .systemLightColor.value
          ? "light"
          : "dark";
      } else {
        this.setting.colorTheme.resultThemeColor.value =
          this.setting.colorTheme.themeColorSetting.value;
      }
    };

    this.setting.colorTheme.themeColorSetting.addValueChangeListener((v) => {
      updateDarkMode();
      localStorage.setItem(themeColorSettingKey, `${v}`);
    });
    this.setting.colorTheme.systemLightColor.addValueChangeListener(
      updateDarkMode,
    );

    updateDarkMode();
  }

  async askConfig() {
    return (
      window as unknown as {
        memo_note_config_promise: Promise<{ path: string }>;
      }
    ).memo_note_config_promise;
  }

  async start() {
    if (!isElectron && !import.meta.env.DEV) {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/doc/client/sw.js");
      }
    }

    const baseDir = (await this.askConfig()).path;

    const root = ReactDOM.createRoot(
      document.getElementById("root") as HTMLElement,
    );

    const MainView: React.FC = () => {
      const [loading, setLoading] = useState(true);
      // const navigate = useNavigate();
      const themeColorMode = useBindableProperty(
        this.setting.colorTheme.resultThemeColor,
      );
      useEffect(() => {
        this.db.open().then(() => {
          setLoading(false);
        });
      }, []);

      // useEffect(() => {
      //   if (loading) {
      //     return;
      //   }
      //   if (isElectron && location.href.includes("index.html")) {
      //     navigate("/");
      //   }
      // }, [loading]);

      const theme = useMemo(
        () =>
          createTheme({
            palette: {
              mode: themeColorMode,
              ...(themeColorMode === "dark" && {
                background: {
                  default: "#1a1a1a", // Softer than default #121212
                  paper: "#242424", // Softer than default #1e1e1e
                },
                text: {
                  primary: "#e0e0e0", // Softer than default #ffffff
                  secondary: "#b0b0b0", // Softer than default #b3b3b3
                },
                primary: {
                  main: "#ce93d8", // Soft purple (not blue)
                },
                secondary: {
                  main: "#f48fb1", // Soft pink
                },
                error: {
                  main: "#ef5350", // Softer red
                },
                warning: {
                  main: "#ffb74d", // Soft orange
                },
                info: {
                  main: "#80deea", // Soft cyan
                },
                success: {
                  main: "#81c784", // Soft green
                },
              }),
            },
          }),
        [themeColorMode],
      );

      if (loading) {
        return <div>loading</div>;
      }
      // inject file path as basename
      return (
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter basename={baseDir}>
            <TitleHandler />
            <Header client={this} />
            <Routes>
              <Route path="/" index element=<HomePage client={this} /> />
              <Route path="/login" element=<LoginPage client={this} /> />
              <Route path="/sign-up" element=<SignUpPage client={this} /> />
              <Route
                path="/my-doc"
                element=<MyDocs client={this} showAllCreateButtons />
              />
              <Route path="/document" element=<QuillEditor client={this} /> />
              <Route
                path="/canvas"
                element=<ExcalidrawCanvas client={this} />
              />
              <Route path="/todo" element=<TodoListEditor client={this} /> />
              <Route path="*" element={<Navigate to="/" replace={true} />} />
            </Routes>
          </BrowserRouter>
          <AskDialogComponent />
          <GlobalSnackBarComponent />
        </ThemeProvider>
      );
    };

    root.render(<MainView />);
  }
}

new Client().start();
