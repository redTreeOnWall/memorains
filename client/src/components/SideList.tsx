import React from "react";
import Box from "@mui/material/Box";
import { IClient } from "../interface/Client";
import { MyDocs } from "./MyDocs";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { IconButton } from "@mui/material";
import { useBindableProperty } from "../hooks/hooks";
import { Space } from "./common/Space";

export const SideList: React.FC<{ client: IClient; selectedId?: string }> = ({
  client,
  selectedId,
}) => {
  const sideListStatus = useBindableProperty(client.sideListStatus.property);
  const showList = sideListStatus === "open";
  return (
    <Box
      sx={{
        width: showList ? "400px" : "0px",
        position: "relative",
        // borderRight: showList ? "1px solid #88888833" : "none",
        height: "100%",
        overflow: showList ? "hidden" : null,
        transition: "width 0.3s",
      }}
    >
      <IconButton
        sx={{
          position: "absolute",
          right: "0px",
          transform: showList ? "rotate(0deg)" : "rotate(180deg)",
          transition: "transform 0.3s",
          borderRadius: "4px",
          width: "24px",
        }}
        onClick={() => {
          client.sideListStatus.property.value = showList ? "close" : "open";
        }}
      >
        <KeyboardDoubleArrowLeftIcon />
      </IconButton>
      {showList ? (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "#88888800 #f1f1f100",
          }}
        >
          <Space />
          <MyDocs client={client} selectedId={selectedId} />
        </Box>
      ) : null}
    </Box>
  );
};
