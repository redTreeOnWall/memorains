import React from "react";
import { Box, Typography, IconButton } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { i18n } from "../internationnalization/utils";

export interface HeadingInfo {
  text: string;
  level: number; // 1–6
  index: number; // Quill document index (character offset)
}

interface OutlinePanelProps {
  headings: HeadingInfo[];
  onHeadingClick: (index: number) => void;
  onClose: () => void;
  isDark: boolean;
}

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  headings,
  onHeadingClick,
  onClose,
  isDark,
}) => {
  const bgColor = isDark ? "#222" : "#f5f5f5";
  const textColor = isDark ? "#bbb" : "#555";
  const hoverBg = isDark ? "#333" : "#e0e0e0";
  const headerBg = isDark ? "#2a2a2a" : "#ebebeb";
  const headerColor = isDark ? "#ccc" : "#333";

  const header = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 8px 16px",
        backgroundColor: headerBg,
        borderBottom: `1px solid ${hoverBg}`,
      }}
    >
      <Typography sx={{ fontSize: "15px", fontWeight: 600, color: headerColor }}>
        {i18n("outline")}
      </Typography>
      <IconButton onClick={onClose} size="small" sx={{ color: textColor }}>
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );

  if (headings.length === 0) {
    return (
      <>
        {header}
        <Box
          sx={{
            backgroundColor: bgColor,
            padding: "12px 16px",
          }}
        >
          <Typography
            sx={{
              fontSize: "14px",
              color: textColor,
              fontStyle: "italic",
            }}
          >
            {i18n("no_headings")}
          </Typography>
        </Box>
      </>
    );
  }

  return (
    <>
      {header}
      <Box
        sx={{
          backgroundColor: bgColor,
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: isDark ? "#555 #222" : "#ccc #f5f5f5",
        }}
      >
        {headings.map((heading, i) => {
          const indent = (heading.level - 1) * 8;

          return (
            <Box
              key={i}
              onClick={() => onHeadingClick(heading.index)}
              sx={{
                padding: `4px 16px 4px ${16 + indent}px`,
                cursor: "pointer",
                color: textColor,
                fontSize: "14px",
                lineHeight: "22px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "background-color 0.15s",
                "&:hover": {
                  backgroundColor: hoverBg,
                },
              }}
            >
              {heading.text}
            </Box>
          );
        })}
      </Box>
    </>
  );
};
