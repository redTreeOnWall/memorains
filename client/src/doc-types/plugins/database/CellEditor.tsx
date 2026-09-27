import React from "react";
import type * as Y from "yjs";
import {
  CheckboxCellEditor,
  DateCellEditor,
  NumberCellEditor,
  OptionCellEditor,
  PlainStringCellEditor,
  TextCellEditor,
} from "./cells";
import type { PropertyDef, RowData } from "./types";

/**
 * Everything a cell editor may do to the document.
 *
 * Grouped into one object so the table and the record panel pass identical
 * callbacks — if they built their own, the two would drift and a cell would behave
 * differently depending on where it was edited.
 */
export interface CellEditorCallbacks {
  /** Commit a discrete value (`number`, option id, date object, …). */
  onChange: (value: unknown) => void;
  /** Commit a text cell from a full string, diffed into one minimal splice. */
  onTextChange: (next: string) => void;
  /** Add or remove one option of a multi-select cell. */
  onToggleOption: (optId: string) => void;
  /** Create an option inline; returns its id, or null if not supported. */
  onCreateOption?: (name: string) => string | null;
}

export interface CellEditorProps {
  property: PropertyDef;
  /** Stored value in plain form. Text cells ignore this and use `text`. */
  value: unknown;
  /** Live `Y.Text` for text-typed cells, or null when the cell is empty. */
  text: Y.Text | null;
  row: RowData;
  callbacks: CellEditorCallbacks;
  disabled?: boolean;
  /** Fill the container instead of sitting inline, as in the record panel. */
  expanded?: boolean;
  autoFocus?: boolean;
  /**
   * Called when an inline editor should close.
   *
   * Only the table uses this: it keeps edit mode to the focused cell. The record
   * panel leaves every field mounted, so it omits the callback.
   */
  onDoneEditing?: () => void;
}

/**
 * The single entry point for editing one cell.
 *
 * Dispatches to the editor for the property's type. Both the table (inline) and
 * the record panel (full width) render **this** component, so there is exactly one
 * implementation per type and no per-view variation — which is what makes editing
 * uniform across every view.
 *
 * An unknown property type falls back to the plain string editor rather than
 * rendering nothing, so a document written by a newer client stays editable
 * instead of showing an empty cell the user cannot fix.
 */
export const CellEditor: React.FC<CellEditorProps> = ({
  property,
  value,
  text,
  row,
  callbacks,
  disabled,
  expanded,
  autoFocus,
  onDoneEditing,
}) => {
  const shared = {
    property,
    value,
    text,
    row,
    disabled,
    expanded,
    autoFocus,
    onDoneEditing,
  };

  switch (property.type) {
    case "title":
    case "text":
      return (
        <TextCellEditor
          {...shared}
          onTextChange={callbacks.onTextChange}
          onChange={callbacks.onChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
    case "number":
      return (
        <NumberCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
    case "checkbox":
      return (
        <CheckboxCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
    case "date":
      return (
        <DateCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
    case "select":
    case "multi-select":
      return (
        <OptionCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
          onCreateOption={callbacks.onCreateOption}
        />
      );
    case "url":
    case "email":
    case "phone":
      return (
        <PlainStringCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
    default:
      // Unknown type from a newer client: keep it editable as text.
      return (
        <PlainStringCellEditor
          {...shared}
          onChange={callbacks.onChange}
          onTextChange={callbacks.onTextChange}
          onToggleOption={callbacks.onToggleOption}
        />
      );
  }
};
