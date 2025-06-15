import { isElectron } from "./const/host";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./HomePage";
import { GlobalSnackBarComponent } from "./components/common/GlobalSnackBar";
import { Header } from "./components/header";
import { LoginPage } from "./components/login";
import { SignUpPage } from "./components/sign-up";
import { IndexedDB } from "./DB/IndexedDB";
import { MyDocs } from "./editor/MyDocs";
import "./index.css";
import { BindableProperty } from "./utils/BindableProperty";
import { useBindableProperty } from "./hooks/hooks";
import { QuillEditor } from "./editor/QuillEditor";

import { ExcalidrawCanvas } from "./components/canvas/ExcalidrawCanvas";
import { AskDialogComponent } from "./components/common/AskDialog";

const themeColorSettingKey = "themeColorSettingKey";

export class Client {
  offlineMode = new BindableProperty(false);

  colorTheme = {
    themeColorSetting: new BindableProperty<"dark" | "light" | "auto">("auto"),
    systemLightColor: new BindableProperty(true),
    resultThemeColor: new BindableProperty<"dark" | "light">("light"),
  };

  db: IndexedDB;

  docListUpdateIndex = new BindableProperty(0);

  headerView = new BindableProperty<React.ReactElement | null>(null);

  constructor() {
    this.db = new IndexedDB();

    this.initOfflineMode();
    this.initColorTheme();
  }

  private initOfflineMode() {
    // init offlineMode
    const online = window.navigator.onLine;
    this.offlineMode.value = online === false;

    window.addEventListener("offline", () => {
      this.offlineMode.value = true;
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

    this.colorTheme.themeColorSetting.value = initDarkModeSetting;

    const updateDarkModeStateByMatchLight = (matchLight: boolean) => {
      this.colorTheme.systemLightColor.value = matchLight;
    };

    const themeMedia = window.matchMedia("(prefers-color-scheme: light)");
    updateDarkModeStateByMatchLight(themeMedia.matches);
    themeMedia.onchange = (e) => {
      updateDarkModeStateByMatchLight(e.matches);
    };

    const updateDarkMode = () => {
      if (this.colorTheme.themeColorSetting.value === "auto") {
        this.colorTheme.resultThemeColor.value = this.colorTheme
          .systemLightColor.value
          ? "light"
          : "dark";
      } else {
        this.colorTheme.resultThemeColor.value =
          this.colorTheme.themeColorSetting.value;
      }
    };

    this.colorTheme.themeColorSetting.addValueChangeListener((v) => {
      updateDarkMode();
      localStorage.setItem(themeColorSettingKey, `${v}`);
    });
    this.colorTheme.systemLightColor.addValueChangeListener(updateDarkMode);

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
        this.colorTheme.resultThemeColor,
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
              // primary: {
              //   main: purple[900],
              // },
              // secondary: {
              //   main: green[500],
              // },
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
            <Header client={this} />
            <Routes>
              <Route path="/" index element=<HomePage client={this} /> />
              <Route path="/login" element=<LoginPage client={this} /> />
              <Route path="/sign-up" element=<SignUpPage client={this} /> />
              <Route path="/my-doc" element=<MyDocs client={this} /> />
              <Route path="/document" element=<QuillEditor client={this} /> />
              <Route
                path="/canvas"
                element=<ExcalidrawCanvas client={this} />
              />
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
