import { Avatar, IconButton } from "@mui/material";
import React from "react";
import { hashColorWitchCache } from "../../utils/utils";

export const User: React.FC<{ onClick: () => void; userName?: string }> = ({
  onClick,
  userName,
}) => {
  const userColor = userName ? hashColorWitchCache(userName) : undefined;
  return (
    <IconButton
      size="small"
      sx={{
        position: "absolute",
        top: "50%",
        transform: "translate(0, -50%)",
        right: (theme) => theme.spacing(),
      }}
      onClick={onClick}
    >
      <Avatar
        sx={{
          width: 36,
          height: 36,
          backgroundColor: userColor
            ? `rgb(${userColor.r}, ${userColor.g}, ${userColor.b})`
            : undefined,
        }}
      >
        {typeof userName === "string" ? userName[0]?.toUpperCase() : null}
      </Avatar>
    </IconButton>
  );
};
