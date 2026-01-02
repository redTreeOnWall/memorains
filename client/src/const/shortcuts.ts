/**
 * Keyboard Shortcut Configuration
 *
 * This file defines all keyboard shortcuts used throughout the application.
 * Shortcuts are configurable and can be easily extended.
 */

export type ShortcutHandler = () => void | Promise<void>;

export interface Shortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** Human-readable description */
  description: string;
  /** Key combination (e.g., "Ctrl+S", "Cmd+S", "Shift+Enter") */
  keyCombo: string;
  /** The handler function to execute */
  handler: ShortcutHandler;
  /** Optional: Whether the shortcut should be prevented from default browser behavior */
  preventDefault?: boolean;
  /** Optional: Whether the shortcut should only work when auto-save is disabled */
  onlyWhenAutoSaveDisabled?: boolean;
  /** Optional: Whether the shortcut should only work in editor context */
  onlyInEditor?: boolean;
}

/**
 * Default shortcut configurations
 * These can be overridden or extended by the application
 */
export const DEFAULT_SHORTCUTS: Omit<Shortcut, "handler">[] = [
  {
    id: "save",
    description: "Save note manually",
    keyCombo: "Ctrl+S",
    preventDefault: true,
    onlyWhenAutoSaveDisabled: true,
    onlyInEditor: true,
  },
  {
    id: "save",
    description: "Save note manually (Mac)",
    keyCombo: "Cmd+S",
    preventDefault: true,
    onlyWhenAutoSaveDisabled: true,
    onlyInEditor: true,
  },
  // Add more default shortcuts here as needed
  // {
  //   id: "bold",
  //   description: "Toggle bold text",
  //   keyCombo: "Ctrl+B",
  //   preventDefault: true,
  //   onlyInEditor: true,
  // },
  // {
  //   id: "italic",
  //   description: "Toggle italic text",
  //   keyCombo: "Ctrl+I",
  //   preventDefault: true,
  //   onlyInEditor: true,
  // },
];

/**
 * Utility function to detect the platform
 */
export const isMac = () => {
  return (
    navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
    navigator.userAgent.includes("Mac")
  );
};

/**
 * Normalize key combination for cross-platform compatibility
 * Converts platform-specific keys (Ctrl/Cmd) to a consistent format
 */
export function normalizeKeyCombo(keyCombo: string): string {
  const normalized = keyCombo.trim();

  if (isMac()) {
    // On Mac, replace "Ctrl" with "Cmd" if not already using "Cmd"
    return normalized.replace(/Ctrl\+/gi, "Cmd+");
  } else {
    // On other platforms, replace "Cmd" with "Ctrl"
    return normalized.replace(/Cmd\+/gi, "Ctrl+");
  }
}

/**
 * Parse a key combination string into its components
 * @param keyCombo - String like "Ctrl+S" or "Shift+Alt+Delete"
 * @returns Object with ctrlKey, altKey, shiftKey, metaKey, and key
 */
export function parseKeyCombo(keyCombo: string) {
  const parts = keyCombo.split("+");
  const key = parts.pop()!.toLowerCase();

  const modifiers = {
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Cmd") || parts.includes("Meta"),
  };

  return { ...modifiers, key };
}

/**
 * Check if a keyboard event matches a key combination
 */
export function matchesKeyCombo(
  event: KeyboardEvent,
  keyCombo: string,
): boolean {
  const normalized = normalizeKeyCombo(keyCombo);
  const expected = parseKeyCombo(normalized);

  // Check each modifier
  if (event.ctrlKey !== expected.ctrlKey) return false;
  if (event.altKey !== expected.altKey) return false;
  if (event.shiftKey !== expected.shiftKey) return false;
  if (event.metaKey !== expected.metaKey) return false;

  // Check the key (case-insensitive)
  if (event.key.toLowerCase() !== expected.key) return false;

  return true;
}

/**
 * Get display string for a key combination (platform-aware)
 */
export function getDisplayKeyCombo(keyCombo: string): string {
  const normalized = normalizeKeyCombo(keyCombo);

  if (isMac()) {
    return normalized
      .replace(/Cmd\+/g, "⌘")
      .replace(/Shift\+/g, "⇧")
      .replace(/Alt\+/g, "⌥")
      .replace(/Ctrl\+/g, "⌃");
  } else {
    return normalized;
  }
}
