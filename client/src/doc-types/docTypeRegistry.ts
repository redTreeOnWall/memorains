import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import { DocType } from "../interface/DataEntity";
import { runExportMarkdown } from "./markdownExport";
import type {
  DocMenuItem,
  DocTypePlugin,
  RoutableDocTypePlugin,
} from "./pluginTypes";

export type {
  DocTypePlugin,
  RoutableDocTypePlugin,
  DocMenuItem,
  DocMenuContext,
  DocMenuTarget,
  IconComponent,
} from "./pluginTypes";

/**
 * Built-in plugins, auto-discovered from one directory per type under
 * `./plugins` (`./plugins/<type>/index.ts`).
 *
 * Dropping a new `<type>/index.ts` directory in there that default-exports a
 * `DocTypePlugin` registers it — no edit to this file required.
 *
 * `eager: true` turns this into static imports, so the plugin modules are
 * evaluated during the normal module graph walk. That is safe here because
 * neither they nor the modules they pull in dereference a registry export at
 * evaluation time (see `buildPlugins` for why construction stays lazy).
 */
const builtinModules = import.meta.glob("./plugins/*/index.ts", {
  eager: true,
}) as Record<string, { default: DocTypePlugin }>;

/**
 * Plugins added at runtime via `registerPlugin`.
 *
 * Kept in a separate array so `reloadPlugins()` can drop them without losing
 * the built-ins, and so a plugin can be registered before the built-ins are
 * ever built.
 */
let runtimePlugins: DocTypePlugin[] = [];

let cachedPlugins: readonly DocTypePlugin[] | null = null;

/**
 * Attach the standard "export as Markdown" menu item to every plugin that can
 * project itself to Markdown.
 *
 * Deriving it here (rather than declaring it in each plugin) means a future
 * type gains both the capability and its menu entry by implementing
 * `toMarkdown` alone. Plugins remain free to declare extra `menuItems`.
 */
function withDerivedMenuItems(plugin: DocTypePlugin): DocTypePlugin {
  const { toMarkdown } = plugin;
  if (!toMarkdown) {
    return plugin;
  }

  const exportItem: DocMenuItem = {
    id: "export-markdown",
    labelKey: "export_markdown",
    Icon: FileDownloadRoundedIcon,
    onClick: (ctx) => runExportMarkdown(toMarkdown, ctx),
  };

  return {
    ...plugin,
    menuItems: [...(plugin.menuItems ?? []), exportItem],
  };
}

const sortPlugins = (plugins: DocTypePlugin[]) =>
  [...plugins].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/**
 * Build the plugin list.
 *
 * Deliberately called lazily (never at module scope): this module is part of a
 * cycle — `docTypeRegistry → plugins/* → editor/CommonEditor → SideList →
 * MyDocs → docTypeRegistry` — so reading the discovered plugin bindings
 * during module evaluation could observe them before initialisation. By the
 * time the app actually asks for a plugin, every module has settled.
 */
function buildPlugins(): readonly DocTypePlugin[] {
  const builtins = Object.values(builtinModules).map((m) => m.default);
  return sortPlugins([...builtins, ...runtimePlugins]).map(
    withDerivedMenuItems,
  );
}

/**
 * Register a plugin at runtime, replacing any existing plugin with the same
 * `type`.
 *
 * This is the extension point for plugins that are not part of the built-in
 * `./plugins` directory (e.g. optional features, or a host app that embeds the
 * editor). Returns a function that removes the plugin again.
 */
export const registerPlugin = (plugin: DocTypePlugin): (() => void) => {
  unregisterPlugin(plugin.type);
  runtimePlugins.push(plugin);
  reloadPlugins();

  return () => unregisterPlugin(plugin.type);
};

/** Remove a runtime-registered plugin. Built-ins cannot be removed. */
export const unregisterPlugin = (type: DocType): boolean => {
  const next = runtimePlugins.filter((plugin) => plugin.type !== type);
  const removed = next.length !== runtimePlugins.length;
  if (removed) {
    runtimePlugins = next;
    reloadPlugins();
  }
  return removed;
};

/** Drop the cache so the next lookup sees newly registered plugins. */
export const reloadPlugins = () => {
  cachedPlugins = null;
};

/** Every registered plugin, including ones without an editor. */
export const getDocTypePlugins = (): readonly DocTypePlugin[] => {
  if (!cachedPlugins) {
    cachedPlugins = buildPlugins();
  }
  return cachedPlugins;
};

/**
 * Look up a plugin by enum value.
 *
 * Returns `undefined` for unknown types (e.g. a document written by a newer
 * client), so callers must choose a fallback rather than assume a hit.
 */
export const getDocTypePlugin = (
  type: DocType | undefined | null,
): DocTypePlugin | undefined => {
  if (type === undefined || type === null) {
    return undefined;
  }
  return getDocTypePlugins().find((plugin) => plugin.type === type);
};

/** Look up a plugin by its stable `id` (the URL path segment). */
export const getDocTypePluginById = (
  id: string | null | undefined,
): DocTypePlugin | undefined => {
  if (!id) {
    return undefined;
  }
  return getDocTypePlugins().find((plugin) => plugin.id === id);
};

/** Plugins that can actually be opened in an editor. */
export const getRoutableDocTypePlugins = (): readonly RoutableDocTypePlugin[] =>
  getDocTypePlugins().filter(
    (plugin): plugin is RoutableDocTypePlugin => plugin.Editor !== null,
  );

/** Plugins offered to the user when creating a document. */
export const getCreatableDocTypePlugins =
  (): readonly RoutableDocTypePlugin[] =>
    getRoutableDocTypePlugins().filter((plugin) => plugin.creatable);

/**
 * Route path segment for a document type.
 *
 * Falls back to the text type so a corrupted or future `doc_type` never
 * produces a dead link. If even the text plugin is missing (a
 * misconfiguration), the raw enum value is used rather than throwing.
 */
export const docTypeRoute = (type: DocType | undefined | null): string =>
  getDocTypePlugin(type)?.id ??
  getDocTypePlugin(DocType.text)?.id ??
  String(type ?? DocType.text);
