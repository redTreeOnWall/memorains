import React from "react";
import { Box, Typography } from "@mui/material";
import { i18n } from "../internationnalization/utils";

export interface HeadingInfo {
  text: string;
  level: number; // 1–6
  index: number; // Quill document index (character offset)
}

interface OutlinePanelProps {
  headings: HeadingInfo[];
  onHeadingClick: (index: number) => void;
  isDark: boolean;
}

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  headings,
  onHeadingClick,
  isDark,
}) => {
  const bgColor = isDark ? "#222" : "#f5f5f5";
  const textColor = isDark ? "#bbb" : "#555";
  const hoverBg = isDark ? "#333" : "#e0e0e0";
  const borderColor = isDark ? "#333" : "#e0e0e0";

  if (headings.length === 0) {
    return (
      <Box
        sx={{
          backgroundColor: bgColor,
          borderBottom: `1px solid ${borderColor}`,
          padding: "12px 16px",
          borderRadius: "8px",
          mb: 1,
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
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: bgColor,
        borderBottom: `1px solid ${borderColor}`,
        borderRadius: "8px",
        mb: 1,
        maxHeight: "300px",
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
  );
};
