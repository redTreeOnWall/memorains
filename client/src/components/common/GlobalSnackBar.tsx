import { Alert, AlertColor } from "@mui/material";
import { Stack } from "@mui/system";
import React from "react";
import { useBindableProperty } from "../../hooks/hooks";
import { BindableProperty } from "../../utils/BindableProperty";

interface SnackBarData {
  type: AlertColor;
  index: number;
  message: string;
  duration: number;
  timerId: NodeJS.Timeout | null;
}

export class GlobalSnackBar {
  private static _instance?: GlobalSnackBar;

  dataVersion = new BindableProperty<number>(0);

  snackbarMap = new Map<number, SnackBarData>();

  private index = 0;

  static getInstance() {
    if (!this._instance) {
      this._instance = new GlobalSnackBar();
    }

    return this._instance;
  }

  pushMessage(
    message: string,
    alertColor: AlertColor = "info",
    duration = 6000,
  ) {
    this.index++;
    const data: SnackBarData = {
      type: alertColor,
      index: this.index,
      message,
      duration,
      timerId: null,
    };

    if (duration > 0) {
      const timeOutId = setTimeout(() => {
        this.removeByIndex(data.index);
      }, duration);
      data.timerId = timeOutId;
    }
    this.snackbarMap.set(data.index, data);

    this.dataVersion.value += 1;
    return data.index;
  }

  removeByIndex(index: number) {
    const data = this.snackbarMap.get(index);

    if (!data) {
      return;
    }

    if (data.timerId !== null) {
      clearTimeout(data.timerId);
    }

    this.snackbarMap.delete(index);
    this.dataVersion.value += 1;
  }
}

export const GlobalSnackBarComponent: React.FC = () => {
  useBindableProperty(GlobalSnackBar.getInstance().dataVersion);

  const list: SnackBarData[] = [];

  for (const [, data] of GlobalSnackBar.getInstance().snackbarMap) {
    list.push(data);
  }

  return (
    <Stack
      style={{
        position: "fixed",
        bottom: "24px",
        zIndex: "9999999",
      }}
      spacing="8px"
    >
      {/* <Snackbar key={d.index} open message={d.message} /> */}
      {list.map((d) => (
        <Alert severity={d.type} key={d.index}>
          {d.message}
        </Alert>
      ))}
    </Stack>
  );
};
