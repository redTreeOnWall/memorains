import { Button, CircularProgress } from "@mui/material";
import React from "react";

type LoadingButtonProps = Parameters<typeof Button>[0] & {
  loading: boolean;
};

export const LoadingButton: React.FC<LoadingButtonProps> = (
  props: LoadingButtonProps,
) => {
  const originProps = { ...props, loading: props.loading ? 1 : 0 };
  return (
    <Button {...originProps} disabled={props.loading}>
      {props.loading ? <CircularProgress size={24} /> : null}
      {props.children}
    </Button>
  );
};
