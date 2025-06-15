import React from "react";
import { useBindableProperty } from "../../hooks/hooks";
import { BindableProperty } from "../../utils/BindableProperty";
import {
  type InputNameDialogProps,
  type InputNameDialogBasicProps,
  InputNameDialog,
} from "./InputNameDialog";

export class AskDialog {
  private textInputResult?: {
    onConfirm: (text: string) => void;
    onCancel: () => void;
    onReplace: () => void;
  };

  props = new BindableProperty<InputNameDialogProps | null>(null);

  openTextInput(params: InputNameDialogBasicProps) {
    return new Promise<
      | {
          type: "confirm";
          text: string;
        }
      | {
          type: "cancel";
        }
      | {
          type: "replace";
        }
    >((resolve) => {
      this.textInputResult?.onReplace();

      this.props.value = null;

      let thisAskClosed = false;
      const close = () => {
        this.props.value = null;
        thisAskClosed = true;
      };

      const textInputResult = {
        onConfirm: (text: string) => {
          if (thisAskClosed) {
            return;
          }
          resolve({ type: "confirm", text });
          close();
        },
        onCancel: () => {
          if (thisAskClosed) {
            return;
          }
          resolve({ type: "cancel" });
          close();
        },
        onReplace: () => {
          if (thisAskClosed) {
            return;
          }
          resolve({ type: "replace" });
          close();
        },
      };

      this.textInputResult = textInputResult;

      this.props.value = {
        ...params,
        open: true,
        onConfirm: (text) => {
          textInputResult.onConfirm(text);
        },
        onClose: () => {
          textInputResult.onCancel();
        },
      };
    });
  }
}

export const askDialog = new AskDialog();

export const AskDialogComponent: React.FC = () => {
  const props = useBindableProperty(askDialog.props);
  return props ? <InputNameDialog {...props} /> : null;
};
