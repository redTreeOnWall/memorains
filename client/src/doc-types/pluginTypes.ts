import type { FC } from "react";
import type SvgIcon from "@mui/material/SvgIcon";
import type { ButtonProps } from "@mui/material/Button";
import type { DocType } from "../interface/DataEntity";
import type { IClient } from "../interface/Client";
import type { I18nKey } from "../internationnalization/utils";

/**
 * MUI icon component type — identical to `typeof SvgIcon`.
 *
 * Declared locally instead of importing `SvgIconComponent` from
 * `@mui/icons-material`, because that module only uses the alias internally
 * and never re-exports it (it is not public API).
 */
export type IconComponent = typeof SvgIcon;

/** Document fields a menu item may inspect to decide whether to appear. */
export interface DocMenuTarget {
  docType: DocType;
  isOwner: boolean;
  isOnlineDoc: boolean;
  encrypted: boolean;
}

/** Everything a plugin menu item needs to perform its action. */
export interface DocMenuContext extends DocMenuTarget {
  client: IClient;
  docId: string;
  title: string;
  /** Toggle the list-wide busy spinner around a long-running action. */
  setBusy: (busy: boolean) => void;
  /** Re-fetch the document list (call after mutating documents). */
  refresh: () => Promise<void>;
}

/**
 * A per-document action contributed by a document type plugin.
 *
 * This is how type-specific features reach the document list menu (export as
 * Markdown, "convert to table", …) without the list view knowing anything
 * about individual types.
 */
export interface DocMenuItem {
  /** Unique within the plugin; used as the React key. */
  id: string;
  labelKey: I18nKey;
  Icon: IconComponent;
  /** Show this item only when it makes sense. Defaults to always visible. */
  visible?: (doc: DocMenuTarget) => boolean;
  /** Runs the action. The list view catches and reports thrown errors. */
  onClick: (ctx: DocMenuContext) => void | Promise<void>;
}

/**
 * A document type plugin.
 *
 * Everything the app knows about a document type lives here, so adding a type
 * is one plugin object plus one editor component — instead of editing a dozen
 * `if (docType === DocType.x)` branches across the UI.
 */
export interface DocTypePlugin {
  /** Enum value persisted in `DocumentEntity.doc_type`. */
  type: DocType;
  /**
   * Stable identifier, also the URL path segment
   * (`document`, `canvas`, `todo`, `chat`).
   */
  id: string;
  /**
   * Sort position in creation menus and type lists. Lower comes first;
   * defaults to 100 so a plugin without an opinion lands after the built-ins.
   */
  order?: number;
  /** i18n key for the type name in lists, filters and tooltips. */
  labelKey: I18nKey;
  /** i18n key for the "create new …" button label. */
  createLabelKey: I18nKey;
  /** Accent color for the type icon. */
  color: string;
  /** MUI palette color for create buttons. */
  buttonColor: ButtonProps["color"];
  Icon: IconComponent;
  /**
   * Full-page editor for this type.
   *
   * `null` declares the type as *known* without an implementation reaching the
   * UI yet (e.g. `DocType.mix`). Such a type gets no route and is never
   * creatable, so a document of that type can never be opened as a different
   * type and silently corrupted.
   */
  Editor: FC<{ client: IClient }> | null;
  /** Offer this type in the "create new document" UI. */
  creatable: boolean;
  /**
   * Project this document's content to Markdown.
   *
   * Used by the export menu item, and the same "one string per document"
   * projection a future full-text search index would want.
   */
  toMarkdown?: (yDoc: import("yjs").Doc) => string;
  /** Type-specific document list menu items. */
  menuItems?: DocMenuItem[];
}

/** A plugin that is guaranteed to have an editor (see `getRoutableDocTypePlugins`). */
export type RoutableDocTypePlugin = DocTypePlugin & {
  Editor: FC<{ client: IClient }>;
};
