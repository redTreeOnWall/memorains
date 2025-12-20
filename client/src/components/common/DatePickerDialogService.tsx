import React from "react";
import { useBindableProperty } from "../../hooks/hooks";
import { BindableProperty } from "../../utils/BindableProperty";
import {
  type DatePickerDialogProps,
  type DatePickerDialogBasicProps,
  DatePickerDialog,
} from "./DatePickerDialog";

export class DatePickerDialogService {
  private result?: {
    onConfirm: (timestamp: number | null) => void;
    onCancel: () => void;
  };

  props = new BindableProperty<DatePickerDialogProps | null>(null);

  open(params: DatePickerDialogBasicProps) {
    return new Promise<
      | {
          type: "confirm";
          timestamp: number;
        }
      | {
          type: "clear";
        }
      | {
          type: "cancel";
        }
    >((resolve) => {
      this.result?.onCancel();

      this.props.value = null;

      let thisDialogClosed = false;
      const close = () => {
        this.props.value = null;
        thisDialogClosed = true;
      };

      const result = {
        onConfirm: (timestamp: number | null) => {
          if (thisDialogClosed) {
            return;
          }
          if (timestamp === null) {
            resolve({ type: "clear" });
          } else {
            resolve({ type: "confirm", timestamp });
          }
          close();
        },
        onCancel: () => {
          if (thisDialogClosed) {
            return;
          }
          resolve({ type: "cancel" });
          close();
        },
      };

      this.result = result;

      this.props.value = {
        ...params,
        open: true,
        onConfirm: (timestamp) => {
          result.onConfirm(timestamp);
        },
        onClose: () => {
          result.onCancel();
        },
      };
    });
  }
}

export const datePickerDialog = new DatePickerDialogService();

export const DatePickerDialogComponent: React.FC = () => {
  const props = useBindableProperty(datePickerDialog.props);
  return props ? <DatePickerDialog {...props} /> : null;
};
