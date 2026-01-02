# Keyboard Shortcuts System

## Overview

This document describes the keyboard shortcut system implemented for the Memorains note-taking application. The system provides a configurable, extensible way to handle keyboard shortcuts across all editor types.

## Features

✅ **Universal Support**: Works across Quill, TodoList, and Excalidraw editors  
✅ **Platform-Aware**: Automatically handles Ctrl (Windows/Linux) vs Cmd (macOS)  
✅ **Configurable**: Easy to add new shortcuts or modify existing ones  
✅ **Conditional**: Shortcuts can be enabled/disabled based on context  
✅ **Clean Architecture**: Centralized management with minimal code duplication  

## Architecture

### Files Created

1. **`src/const/shortcuts.ts`** - Core configuration and utilities
2. **`src/utils/ShortcutManager.ts`** - Central shortcut management system
3. **`src/editor/CommonEditor.tsx`** - Integration point for all editors

### How It Works

```
User presses Ctrl+S or Cmd+S
    ↓
ShortcutManager detects the key combination
    ↓
Checks if auto-save is disabled
    ↓
If yes: triggers docInstance.trySaveLocal()
    ↓
Shows "Save triggered by shortcut" message
```

## Usage

### Automatic Integration

The save shortcuts (Ctrl+S/Cmd+S) are **automatically available** in all editors when auto-save is disabled. No additional code is needed!

### What Happens

When you press **Ctrl+S** (Windows/Linux) or **Cmd+S** (macOS):

1. **If auto-save is ON**: Nothing happens (shortcut is ignored)
2. **If auto-save is OFF**: 
   - The note is saved immediately
   - A confirmation message appears
   - The save icon animates briefly

### Supported Editors

- ✅ **QuillEditor** (Rich text editor)
- ✅ **TodoListEditor** (Task management)
- ✅ **ExcalidrawCanvas** (Canvas drawing)

## Configuration

### Default Shortcuts

The system is configured in `src/const/shortcuts.ts`:

```typescript
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
];
```

### Adding New Shortcuts

To add a new shortcut, modify `CommonEditor.tsx`:

```typescript
// In the keyboard shortcuts useEffect
const newShortcutHandler = () => {
  // Your custom logic here
  console.log("New shortcut triggered!");
};

manager.register({
  id: "my-new-action",
  description: "My New Action",
  keyCombo: "Ctrl+K", // or "Cmd+K" for Mac
  handler: newShortcutHandler,
  preventDefault: true,
  onlyWhenAutoSaveDisabled: false, // Works even with auto-save
  onlyInEditor: true, // Only when typing in editor
});
```

## Platform Support

| Platform | Key Combination | Display |
|----------|----------------|---------|
| Windows  | `Ctrl+S`       | ⌃S      |
| Linux    | `Ctrl+S`       | ⌃S      |
| macOS    | `Cmd+S`        | ⌘S      |

The system automatically normalizes key combinations based on the user's platform.

## API Reference

### ShortcutManager

#### Methods

- `register(shortcut: Shortcut)` - Register a single shortcut
- `registerMany(shortcuts: Shortcut[])` - Register multiple shortcuts
- `unregister(id: string)` - Remove a shortcut
- `unregisterMany(ids: string[])` - Remove multiple shortcuts
- `clear()` - Remove all shortcuts
- `executeShortcut(id: string)` - Manually trigger a shortcut
- `getAllShortcuts()` - Get all registered shortcuts

#### Properties

- `isInitialized` - Whether the manager is initialized

### Shortcut Interface

```typescript
interface Shortcut {
  id: string;                    // Unique identifier
  description: string;           // Human-readable description
  keyCombo: string;              // "Ctrl+S", "Cmd+S", etc.
  handler: () => void;           // Function to execute
  preventDefault?: boolean;      // Prevent browser default
  onlyWhenAutoSaveDisabled?: boolean; // Only when auto-save off
  onlyInEditor?: boolean;        // Only in editor context
}
```

## Common Issues & Solutions

### Issue: Shortcut not working

**Solution**: Check if auto-save is enabled. Shortcuts only work when auto-save is disabled.

### Issue: Shortcut works in one editor but not others

**Solution**: All editors inherit from CommonEditor, so save shortcuts should work everywhere. Check if you're in view mode (shortcuts disabled).

### Issue: Want to add custom shortcuts

**Solution**: Add them in the `useEffect` hook in CommonEditor.tsx, or create a custom hook for editor-specific shortcuts.

## Future Enhancements

The system is designed to be easily extended. Potential additions:

1. **Navigation shortcuts**: Ctrl+Right/Left for next/previous note
2. **Formatting shortcuts**: Ctrl+B for bold, Ctrl+I for italic (Quill)
3. **Task shortcuts**: Ctrl+Enter to add task, Ctrl+Delete to clear completed
4. **Drawing shortcuts**: Delete to remove selected elements
5. **Customizable shortcuts**: UI for users to change key bindings

## Testing

To test the implementation:

1. Open any note (Quill, TodoList, or Canvas)
2. Go to Settings → Disable "Auto save to local"
3. Make some changes
4. Press Ctrl+S (Windows/Linux) or Cmd+S (macOS)
5. Verify the note saves and shows confirmation message

## Files Modified

- `src/editor/CommonEditor.tsx` - Added shortcut registration
- `src/internationnalization/stringMap.ts` - Added save message translation

## Files Created

- `src/const/shortcuts.ts` - Configuration and utilities
- `src/utils/ShortcutManager.ts` - Core management system
- `src/const/SHORTCUTS_README.md` - This documentation

## Summary

The keyboard shortcut system provides a clean, extensible way to handle keyboard shortcuts across all editors. The save shortcut (Ctrl+S/Cmd+S) is now available in all editors when auto-save is disabled, providing a consistent user experience across the application.