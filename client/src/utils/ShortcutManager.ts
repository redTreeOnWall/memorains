import {
  Shortcut,
  matchesKeyCombo,
  normalizeKeyCombo,
} from "../const/shortcuts";

/**
 * ShortcutManager - Centralized management of keyboard shortcuts
 *
 * This class provides a way to register, unregister, and execute keyboard shortcuts
 * in a configurable and extensible manner.
 */
export class ShortcutManager {
  private static instance: ShortcutManager | null = null;
  private shortcuts: Map<string, Shortcut> = new Map();
  private isInitialized = false;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of ShortcutManager
   */
  static getInstance(): ShortcutManager {
    if (!ShortcutManager.instance) {
      ShortcutManager.instance = new ShortcutManager();
    }
    return ShortcutManager.instance;
  }

  /**
   * Initialize the shortcut manager with global event listeners
   * This should be called once at application startup
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Add global keyboard event listener
    document.addEventListener("keydown", this.handleKeyDown.bind(this), {
      capture: true, // Capture at the capture phase to handle before other handlers
    });

    this.isInitialized = true;
    console.log("ShortcutManager initialized");
  }

  /**
   * Cleanup - remove event listeners
   */
  destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    document.removeEventListener("keydown", this.handleKeyDown.bind(this), {
      capture: true,
    });

    this.isInitialized = false;
  }

  /**
   * Handle keyboard events and execute matching shortcuts
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Don't handle shortcuts if typing in input/textarea/contenteditable
    const target = event.target as HTMLElement;
    const isInputTarget =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    // Iterate through all registered shortcuts
    for (const [id, shortcut] of this.shortcuts) {
      // Skip if shortcut only works in editor and we're not in an editor context
      if (shortcut.onlyInEditor && !isInputTarget) {
        continue;
      }

      // Check if the key combination matches
      if (matchesKeyCombo(event, shortcut.keyCombo)) {
        // Execute the handler
        try {
          const result = shortcut.handler();

          // If handler returns a promise, handle it
          if (result instanceof Promise) {
            result.catch((error) => {
              console.error(
                `Error executing shortcut handler for ${id}:`,
                error,
              );
            });
          }
        } catch (error) {
          console.error(`Error executing shortcut handler for ${id}:`, error);
        }

        // Prevent default browser behavior if requested
        if (shortcut.preventDefault) {
          event.preventDefault();
          event.stopPropagation();
        }

        // Stop iterating once we've found and executed a matching shortcut
        // This prevents multiple shortcuts from firing for the same key press
        break;
      }
    }
  }

  /**
   * Register a new shortcut
   */
  register(shortcut: Shortcut): void {
    // Normalize the key combination for the current platform
    const normalizedKeyCombo = normalizeKeyCombo(shortcut.keyCombo);
    const normalizedShortcut = {
      ...shortcut,
      keyCombo: normalizedKeyCombo,
    };

    this.shortcuts.set(shortcut.id, normalizedShortcut);
    console.log(`Registered shortcut: ${shortcut.id} (${normalizedKeyCombo})`);
  }

  /**
   * Register multiple shortcuts at once
   */
  registerMany(shortcuts: Shortcut[]): void {
    shortcuts.forEach((shortcut) => this.register(shortcut));
  }

  /**
   * Unregister a shortcut by ID
   */
  unregister(id: string): void {
    this.shortcuts.delete(id);
    console.log(`Unregistered shortcut: ${id}`);
  }

  /**
   * Unregister multiple shortcuts by IDs
   */
  unregisterMany(ids: string[]): void {
    ids.forEach((id) => this.unregister(id));
  }

  /**
   * Clear all shortcuts
   */
  clear(): void {
    this.shortcuts.clear();
    console.log("All shortcuts cleared");
  }

  /**
   * Get all registered shortcuts
   */
  getAllShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Get a specific shortcut by ID
   */
  getShortcut(id: string): Shortcut | undefined {
    return this.shortcuts.get(id);
  }

  /**
   * Check if a shortcut is registered
   */
  hasShortcut(id: string): boolean {
    return this.shortcuts.has(id);
  }

  /**
   * Execute a shortcut handler manually by ID
   */
  executeShortcut(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) {
      console.warn(`Shortcut not found: ${id}`);
      return false;
    }

    try {
      const result = shortcut.handler();
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(`Error executing shortcut handler for ${id}:`, error);
        });
      }
      return true;
    } catch (error) {
      console.error(`Error executing shortcut handler for ${id}:`, error);
      return false;
    }
  }
}

/**
 * React hook for using keyboard shortcuts
 * This hook provides a convenient way to register shortcuts in React components
 */
import { useEffect, useRef } from "react";

export interface UseShortcutOptions {
  /** Whether the shortcuts should be active */
  enabled?: boolean;
  /** Whether shortcuts should only work when auto-save is disabled */
  onlyWhenAutoSaveDisabled?: boolean;
  /** Whether shortcuts should only work in editor context */
  onlyInEditor?: boolean;
}

/**
 * React hook for managing keyboard shortcuts
 *
 * @param shortcuts - Array of shortcuts to register
 * @param options - Configuration options
 */
export function useKeyboardShortcuts(
  shortcuts: Omit<Shortcut, "handler" | "id">[],
  options: UseShortcutOptions = {},
): void {
  const manager = ShortcutManager.getInstance();
  const shortcutsRef = useRef(shortcuts);

  // Update ref when shortcuts change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    // Initialize manager if not already initialized
    if (!manager["isInitialized"]) {
      manager.initialize();
    }

    // Register shortcuts
    const shortcutIds: string[] = [];

    shortcutsRef.current.forEach((shortcutConfig) => {
      // Generate a unique ID based on the key combo
      const id = `dynamic-${shortcutConfig.keyCombo}-${Date.now()}-${Math.random()}`;

      const fullShortcut: Shortcut = {
        ...shortcutConfig,
        id,
        handler: () => {
          // This will be overridden by the component using this hook
          // The actual handler should be set via a callback or context
          console.warn(
            `Handler not implemented for shortcut: ${shortcutConfig.keyCombo}`,
          );
        },
        onlyWhenAutoSaveDisabled: options.onlyWhenAutoSaveDisabled,
        onlyInEditor: options.onlyInEditor,
      };

      manager.register(fullShortcut);
      shortcutIds.push(id);
    });

    // Cleanup: unregister shortcuts when component unmounts
    return () => {
      shortcutIds.forEach((id) => manager.unregister(id));
    };
  }, [
    manager,
    options.enabled,
    options.onlyWhenAutoSaveDisabled,
    options.onlyInEditor,
  ]);
}

/**
 * Utility function to create a shortcut handler that checks auto-save setting
 */
export function createAutoSaveAwareHandler(
  handler: () => void,
  autoSaveEnabled: boolean,
): () => void {
  return () => {
    // Only execute if auto-save is disabled
    if (!autoSaveEnabled) {
      handler();
    }
  };
}
