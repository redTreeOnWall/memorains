import React, { useEffect, useMemo, useRef, useState } from "react";
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
  /** If set, the panel will scroll this heading into view on mount. */
  scrollToIndex?: number;
}

interface TreeNode {
  heading: HeadingInfo;
  children: TreeNode[];
}

function buildTree(headings: HeadingInfo[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  for (const h of headings) {
    const node: TreeNode = { heading: h, children: [] };
    while (
      stack.length > 0 &&
      stack[stack.length - 1].heading.level >= h.level
    ) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

const levelFontSize: Record<number, string> = {
  1: "17px",
  2: "15px",
  3: "14px",
  4: "13px",
  5: "12px",
  6: "11px",
};

const levelFontWeight: Record<number, number> = {
  1: 700,
  2: 600,
  3: 500,
  4: 400,
  5: 400,
  6: 400,
};

function levelColor(level: number, isDark: boolean): string {
  if (isDark) {
    const tones = ["#eee", "#ddd", "#ccc", "#bbb", "#aaa", "#999"];
    return tones[Math.min(level, 6) - 1] ?? "#999";
  }
  const tones = ["#111", "#222", "#333", "#444", "#555", "#666"];
  return tones[Math.min(level, 6) - 1] ?? "#666";
}

// ── Tree-item ────────────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  onHeadingClick: (index: number) => void;
  isDark: boolean;
  ancestorLines: boolean[];
}

const INDENT = 24;

const TreeItem: React.FC<TreeItemProps> = ({
  node,
  onHeadingClick,
  isDark,
  ancestorLines,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const hasKids = node.children.length > 0;
  const level = node.heading.level;
  const lineColor = isDark ? "#555" : "#ccc";
  const hoverBg = isDark ? "#333" : "#e0e0e0";
  const toggleHoverBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  return (
    <>
      {/* ── Row ── */}
      <Box
        data-heading-index={node.heading.index}
        sx={{
          display: "flex",
          alignItems: "center",
          minHeight: 32,
        }}
      >
        {/* Ancestor vertical-line columns */}
        {ancestorLines.map((draw, i) => (
          <Box
            key={i}
            sx={{
              width: INDENT,
              minWidth: INDENT,
              height: "100%",
              position: "relative",
            }}
          >
            {draw && (
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundColor: lineColor,
                }}
              />
            )}
          </Box>
        ))}

        {/* Connector cell — the whole cell is the collapse toggle target */}
        <Box
          id="test_box"
          sx={{
            width: INDENT,
            minWidth: INDENT,
            height: "32px",
            position: "relative",
            cursor: hasKids ? "pointer" : "default",
            borderRadius: 1,
            "&:hover": hasKids ? { backgroundColor: toggleHoverBg } : undefined,
          }}
          onClick={hasKids ? () => setCollapsed(!collapsed) : undefined}
        >
          {/* toggle / dot */}
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
              pointerEvents: "none",
            }}
          >
            {hasKids ? (
              <Box
                component="span"
                sx={{
                  fontSize: 12,
                  color: lineColor,
                  transform: collapsed ? "rotate(-90deg)" : "none",
                  transition: "transform 0.15s",
                  lineHeight: 1,
                  userSelect: "none",
                }}
              >
                ▼
              </Box>
            ) : (
              <Box
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  backgroundColor: lineColor,
                }}
              />
            )}
          </Box>
        </Box>

        {/* Text area — clicking navigates to the heading */}
        <Box
          sx={{
            flex: 1,
            cursor: "pointer",
            py: "4px",
            minWidth: 0,
            "&:hover": { backgroundColor: hoverBg },
          }}
          onClick={() => onHeadingClick(node.heading.index)}
        >
          <Typography
            sx={{
              fontSize: levelFontSize[level] ?? "14px",
              fontWeight: levelFontWeight[level] ?? 400,
              color: levelColor(level, isDark),
              lineHeight: "22px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              userSelect: "none",
              pr: "8px",
            }}
          >
            {node.heading.text}
          </Typography>
        </Box>
      </Box>

      {/* ── Children ── */}
      {!collapsed &&
        hasKids &&
        node.children.map((child, idx) => {
          const isLastSibling = idx === node.children.length - 1;
          return (
            <TreeItem
              key={`${child.heading.index}-${idx}`}
              node={child}
              onHeadingClick={onHeadingClick}
              isDark={isDark}
              ancestorLines={[...ancestorLines, !isLastSibling]}
            />
          );
        })}
    </>
  );
};

// ── Panel ────────────────────────────────────────────────────────────────────────

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  headings,
  onHeadingClick,
  onClose,
  isDark,
  scrollToIndex,
}) => {
  const tree = useMemo(() => buildTree(headings), [headings]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the heading nearest the editor viewport when panel opens
  useEffect(() => {
    if (scrollToIndex === undefined || !scrollContainerRef.current) return;

    const timer = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(
        `[data-heading-index="${scrollToIndex}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [scrollToIndex]);

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
      <Typography
        sx={{ fontSize: "15px", fontWeight: 600, color: headerColor }}
      >
        {i18n("outline")}
      </Typography>
      <IconButton onClick={onClose} size="small" sx={{ color: textColor }}>
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );

  if (tree.length === 0) {
    return (
      <>
        {header}
        <Box sx={{ backgroundColor: bgColor, padding: "12px 16px" }}>
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
        ref={scrollContainerRef}
        sx={{
          backgroundColor: bgColor,
          overflowY: "auto",
          overflowX: "auto",
          scrollbarWidth: "thin",
          padding: "16px",
          scrollbarColor: isDark ? "#555 #222" : "#ccc #f5f5f5",
          py: "8px",
        }}
      >
        {tree.map((node, i) => (
          <TreeItem
            key={`${node.heading.index}-${i}`}
            node={node}
            onHeadingClick={onHeadingClick}
            isDark={isDark}
            ancestorLines={[]}
          />
        ))}
      </Box>
    </>
  );
};
