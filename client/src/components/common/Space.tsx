import Box from "@mui/material/Box";
import React from "react";
export const Space: React.FC<{ size?: number }> = ({ size = 1 }) => (
  <Box
    component="div"
    sx={{ display: "inline", marginLeft: (theme) => theme.spacing(size) }}
  />
);
