import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  MenuList,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import {
  CommonEditor,
  type CoreEditorProps,
} from "../../../editor/CommonEditor";
import type { IClient } from "../../../interface/Client";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { GlobalSnackBar } from "../../../components/common/GlobalSnackBar";
import { InputNameDialog } from "../../../components/common/InputNameDialog";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog";
import { DatabaseBinding, DB_ORIGIN } from "./model";
import { TableView } from "./TableView";
import { ListView } from "./ListView";
import { BoardView } from "./BoardView";
import { JournalView } from "./JournalView";
import { GanttView } from "./GanttView";
import { ChartView } from "./ChartView";
import { RecordPanel } from "./RecordPanel";
import { ViewSettingsButton } from "./ViewSettings";
import type { ViewLayout } from "./types";

/** Layouts a view can switch between, in menu order. */
const VIEW_LAYOUTS: {
  layout: ViewLayout;
  labelKey:
    | "db_view_table"
    | "db_view_list"
    | "db_view_board"
    | "db_view_journal"
    | "db_view_gantt"
    | "db_view_chart";
}[] = [
  { layout: "table", labelKey: "db_view_table" },
  { layout: "list", labelKey: "db_view_list" },
  { layout: "board", labelKey: "db_view_board" },
  { layout: "journal", labelKey: "db_view_journal" },
  { layout: "gantt", labelKey: "db_view_gantt" },
  { layout: "chart", labelKey: "db_view_chart" },
];

/**
 * Column names used when a journal or Gantt has to create its own date column.
 *
 * Localised, unlike the seeded default schema, because this column is created by a
 * specific user's action at a specific moment — and it appears for everybody, so a
 * name in the creator's language is the most explicable outcome.
 */
const createJournalDateColumn = (binding: DatabaseBinding): string => {
  const name = i18n("db_journal_calendar_prop");
  binding.addProperty(name, "date");
  return name;
};

/**
 * The date column a Gantt view creates when it has none, and the pointer to it.
 *
 * Named as a **start** rather than a generic "Date": the view reads a pair, and the
 * column it creates is the left edge. Only one is created — an end column is optional,
 * and one-day bars are a reasonable opening state, whereas two columns is more schema
 * change than one click on a layout menu should cause.
 *
 * The view id is a parameter rather than read from `getActiveView()`: the layout menu
 * names the view it was opened for, and the active view can move under a collaborator's
 * click — so reading it here could point the new column at a different view.
 */
const createGanttStartColumn = (
  binding: DatabaseBinding,
  viewId: string,
): string => {
  // A column **name**, not the settings label: `db_gantt_start_prop` reads "Start
  // column" in the picker, which is a caption for a control rather than a name a reader
  // wants in a table header.
  const name = i18n("db_gantt_start_prop_name");
  const propId = binding.addProperty(name, "date");
  binding.setViewGanttColumn(viewId, "startProp", propId);
  return name;
};

/**
 * The database editor.
 *
 * Owns the binding's lifecycle — create, observe, repair, destroy — plus the view
 * chrome: tabs, view actions and the record panel. Each view is a pure renderer
 * over the binding, so there is no per-view logic here.
 */
const DatabaseEditorInner: React.FC<CoreEditorProps> = ({
  client,
  docInstance,
  onBind,
}) => {
  const [binding, setBinding] = useState<DatabaseBinding | null>(null);
  /** Bumped on every document change, to drive re-reads in the views. */
  const [revision, setRevision] = useState(0);
  /**
   * Which view is open, read from the document so it is shared with collaborators
   * (`binding.getActiveViewId`). No local `useState`: two sources of truth would
   * drift the moment a remote client switched tabs.
   */
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [viewMenuAnchor, setViewMenuAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [renamingView, setRenamingView] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [repaired, setRepaired] = useState(false);
  /** Set when this client created a date column for a journal, so it can be explained. */
  const [createdColumn, setCreatedColumn] = useState<string | null>(null);

  const readOnly = docInstance?.viewMode ?? false;
  const offlineMode = client.offlineMode.value;

  /**
   * Coalesce re-renders to an animation frame.
   *
   * One transaction can emit several update events (inserting a row sets its id and
   * order and every initial value), and each would otherwise trigger a full re-read
   * of every row.
   */
  const pendingFrame = useRef<number | null>(null);
  const scheduleRevision = useCallback(() => {
    if (pendingFrame.current !== null) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      setRevision((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    if (!docInstance) return;
    const newBinding = new DatabaseBinding(docInstance.yDoc, scheduleRevision);
    setBinding(newBinding);

    // Must equal `DB_ORIGIN`, or `NoteDocument` will not forward our updates to
    // the server: it ignores updates whose origin is not the editor's.
    docInstance.editor.getOrigin = () => DB_ORIGIN;

    // Deliberately NOT `initIfEmpty()`: the default schema is created once at
    // document creation (`initialState` in index.ts). Seeding here would run before
    // the stored state is loaded and produce duplicate columns and views.
    setRepaired(newBinding.repairOrderIfNeeded());
    onBind();

    // Adopt a stored selection, or fall back to the first view. `getActiveView`
    // handles a dangling id (the view was deleted), so no repair is needed here.
    const initial = newBinding.getActiveView();
    if (initial && newBinding.getActiveViewId() !== initial.id) {
      newBinding.setActiveViewId(initial.id);
    }

    const onOfflineData = () => {
      docInstance.editor.setLoading(false);
      // A remote update may have landed since the initial repair.
      setRepaired(newBinding.repairOrderIfNeeded());
      scheduleRevision();
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineData();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineData);
    }

    return () => {
      docInstance.offlineDataLoaded.removeValueChangeListener(onOfflineData);
      newBinding.destroy();
    };
  }, [docInstance, scheduleRevision, onBind]);

  useEffect(
    () => () => {
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    },
    [],
  );

  const views = useMemo(() => binding?.getViews() ?? [], [binding, revision]);
  const activeView = useMemo(
    () => binding?.getActiveView(),
    [binding, revision],
  );

  const openRow = useMemo(() => {
    if (!binding || !openRowId) return null;
    return (
      binding.getRows().find((candidate) => candidate.id === openRowId) ?? null
    );
  }, [binding, openRowId, revision]);
  // Close the panel if the open record disappears (deleted here or remotely).
  useEffect(() => {
    if (openRowId && !openRow) setOpenRowId(null);
  }, [openRowId, openRow]);

  /**
   * Switch a view's layout, creating a date column first if the new layout needs one.
   *
   * This is the **only** place such a column is created, and it runs exclusively from a
   * user event. That restriction is load-bearing: a client that created the column while
   * merely *rendering* the view would add it for every collaborator. The schema change is
   * the side effect of one person's click.
   *
   * Column before layout. That order is a **UI race**, not a CRDT requirement —
   * changing the layout first would render one frame in which the view has no date
   * column, which is the state in which it refuses to create a record (journal) or draw
   * anything (Gantt).
   *
   * The Gantt gets a `start` column from the same rule the journal's calendar column
   * follows. A Gantt with no date column is as dead-ended as a journal with none, and
   * making one layout seed its own column while the other tells the user to go and add
   * one would be an inconsistency with no principle behind it. It gets **one** column,
   * not two: an end is optional, and one-day bars are a sensible opening state.
   */
  const switchLayout = (viewId: string, layout: ViewLayout) => {
    // `binding` is null until the document is bound; the layout menu is only
    // reachable once the editor has rendered, but the guard is what makes that
    // visible to the type checker rather than assumed.
    if (!binding) return;
    if (layout === "journal" && !binding.getViewCalendarProperty(viewId)) {
      setCreatedColumn(createJournalDateColumn(binding));
    }
    if (layout === "gantt" && !binding.getViewGanttColumns(viewId).start) {
      setCreatedColumn(createGanttStartColumn(binding, viewId));
    }
    binding.setViewLayout(viewId, layout);
    // Bumped explicitly: the views re-read on this, and the transactions above
    // may coalesce into a single render frame.
    scheduleRevision();
  };

  /**
   * Create a date column for the journal view the user is already looking at.
   *
   * The recovery path for a journal whose date column was deleted (locally or by a
   * collaborator) while it was open. Same single creation site, same user-event
   * requirement as `switchLayout`.
   */
  const addCalendarProperty = () => {
    if (!binding) return;
    setCreatedColumn(createJournalDateColumn(binding));
    scheduleRevision();
  };

  if (!docInstance || !binding) {
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {readOnly ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            {i18n("db_readonly_hint")}
          </Alert>
        ) : null}

        {repaired ? (
          <Alert
            severity="warning"
            sx={{ mb: 1 }}
            onClose={() => setRepaired(false)}
          >
            {i18n("db_order_repaired")}
          </Alert>
        ) : null}

        {/* The journal's date column is created by one person's click but appears
            for everybody, so the schema change is explained rather than silent. The
            Gantt's start column is created the same way and said in the same words,
            which is why one message covers both. */}
        {createdColumn ? (
          <Alert
            severity="info"
            sx={{ mb: 1 }}
            onClose={() => setCreatedColumn(null)}
          >
            {Format(i18n("db_journal_created_date_column"), {
              name: createdColumn,
            })}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Tabs
            value={activeView?.id ?? false}
            onChange={(_event, value: string) => binding.setActiveViewId(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 40,
              flex: 1,
              // A thin, low-contrast indicator: without it the tab row floats free
              // of the table it labels.
              "& .MuiTabs-indicator": {
                height: 2,
                borderRadius: "2px 2px 0 0",
              },
            }}
          >
            {views.map((view) => (
              <Tab
                key={view.id}
                value={view.id}
                label={view.name}
                sx={{
                  minHeight: 40,
                  textTransform: "none",
                  fontWeight: 500,
                  fontSize: "0.875rem",
                  letterSpacing: 0,
                  color: "text.secondary",
                  "&.Mui-selected": { color: "text.primary", fontWeight: 600 },
                }}
              />
            ))}
          </Tabs>

          {activeView ? (
            <ViewSettingsButton
              binding={binding}
              viewId={activeView.id}
              revision={revision}
            />
          ) : null}
          {!readOnly ? (
            <>
              <Tooltip title={i18n("db_new_view")}>
                <IconButton
                  size="small"
                  onClick={() => {
                    // The label is localised for this client, but flagged as the
                    // auto-generated default so switching the layout still
                    // renames it. Comparing strings would not work, since the
                    // stored name is whatever language created the view.
                    binding.addView(i18n("db_view_list"), "list", {
                      isDefaultName: true,
                    });
                    // `addView` also selects it, since creating a view means
                    // wanting to look at it.
                    scheduleRevision();
                  }}
                  aria-label={i18n("db_new_view")}
                  sx={{ color: "text.secondary" }}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton
                size="small"
                disabled={!activeView}
                onClick={(event) => setViewMenuAnchor(event.currentTarget)}
                aria-label={i18n("db_rename_view")}
                sx={{ color: "text.secondary" }}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </>
          ) : null}
        </Box>

        <Box sx={{ flex: 1, overflow: "auto", pt: 1 }}>
          {activeView ? (
            activeView.layout === "list" ? (
              <ListView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
                onOpenRecord={setOpenRowId}
              />
            ) : activeView.layout === "board" ? (
              <BoardView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
                onOpenRecord={setOpenRowId}
              />
            ) : activeView.layout === "journal" ? (
              <JournalView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
                onOpenRecord={setOpenRowId}
                onCreateCalendarProperty={
                  readOnly ? undefined : addCalendarProperty
                }
              />
            ) : activeView.layout === "gantt" ? (
              <GanttView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
                onOpenRecord={setOpenRowId}
              />
            ) : activeView.layout === "chart" ? (
              <ChartView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
              />
            ) : (
              // Any unrecognised layout falls back to the table, so a document
              // written by a newer client still renders its data.
              <TableView
                binding={binding}
                viewId={activeView.id}
                readOnly={readOnly}
                revision={revision}
                onOpenRecord={setOpenRowId}
              />
            )
          ) : (
            <Typography variant="body2" color="text.secondary">
              {i18n("db_no_rows")}
            </Typography>
          )}
        </Box>

        {offlineMode ? (
          <Chip
            size="small"
            label={i18n("offline_saved")}
            sx={{ alignSelf: "flex-start", mt: 0.5 }}
          />
        ) : null}
      </Box>

      <Menu
        open={viewMenuAnchor !== null}
        anchorEl={viewMenuAnchor}
        onClose={() => setViewMenuAnchor(null)}
      >
        <MenuList dense sx={{ minWidth: 200 }}>
          <MenuItem
            onClick={() => {
              if (activeView) {
                setRenamingView({ id: activeView.id, name: activeView.name });
              }
              setViewMenuAnchor(null);
            }}
          >
            {i18n("db_rename_view")}
          </MenuItem>
          <Divider />
          {VIEW_LAYOUTS.map(({ layout, labelKey }) => (
            <MenuItem
              key={layout}
              selected={activeView?.layout === layout}
              onClick={() => {
                if (activeView) switchLayout(activeView.id, layout);
                setViewMenuAnchor(null);
              }}
            >
              {i18n(labelKey)}
            </MenuItem>
          ))}
          <Divider />
          <MenuItem
            disabled={views.length <= 1}
            onClick={() => {
              if (activeView) setDeletingViewId(activeView.id);
              setViewMenuAnchor(null);
            }}
          >
            {i18n("db_delete_view")}
          </MenuItem>
        </MenuList>
      </Menu>

      <InputNameDialog
        open={renamingView !== null}
        title={i18n("db_rename_view")}
        label={i18n("db_property_name")}
        buttonText={i18n("confirm_button")}
        initText={renamingView?.name}
        onConfirm={(name) => {
          if (renamingView && name.trim()) {
            binding.renameView(renamingView.id, name.trim());
          }
          setRenamingView(null);
        }}
        onClose={() => setRenamingView(null)}
      />

      <ConfirmDialog
        open={deletingViewId !== null}
        title={i18n("db_delete_view")}
        content={i18n("db_delete_view_last")}
        confirmText={i18n("delete_doc")}
        confirmColor="error"
        onConfirm={() => {
          if (deletingViewId) {
            const before = binding.getViews().length;
            binding.deleteView(deletingViewId);
            if (binding.getViews().length === before) {
              // The binding refuses to remove the last view.
              GlobalSnackBar.getInstance().pushMessage(
                i18n("db_delete_view_last"),
                "warning",
              );
            } else {
              // `deleteView` repoints the shared selection when the deleted view
              // was the active one, in the same transaction.
              scheduleRevision();
            }
          }
          setDeletingViewId(null);
        }}
        onClose={() => setDeletingViewId(null)}
      />

      <RecordPanel
        binding={binding}
        row={openRow}
        onClose={() => setOpenRowId(null)}
        readOnly={readOnly}
      />
    </>
  );
};

/**
 * Plugin entry point.
 *
 * `CommonEditor` supplies the `NoteDocument` through its `CoreEditor` render prop,
 * which is what binds this editor to the document's `Y.Doc`.
 */
export const DatabaseEditor: React.FC<{ client: IClient }> = ({ client }) => (
  <CommonEditor client={client} CoreEditor={DatabaseEditorInner} />
);

export default DatabaseEditor;
