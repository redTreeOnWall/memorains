import { DocType } from "../interface/DataEntity";

/**
 * Document type configuration
 * Defines colors for each document type
 */
export interface DocTypeConfig {
  /** Main color for the document type */
  mainColor: string;
}

/**
 * Configuration map for document types
 * Uses descriptive color names
 */
export const DOC_TYPE_CONFIG: Record<DocType, DocTypeConfig> = {
  [DocType.text]: {
    mainColor: "#1976d2", // Blue
  },
  [DocType.canvas]: {
    mainColor: "#9c27b0", // Purple
  },
  [DocType.mix]: {
    mainColor: "#0288d1", // Cyan
  },
  [DocType.todo]: {
    mainColor: "#2e7d32", // Green
  },
};
