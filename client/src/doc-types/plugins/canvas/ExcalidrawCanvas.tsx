import { CommonEditor, CoreEditorProps } from "../../../editor/CommonEditor";
import { IClient } from "../../../interface/Client";
import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import { Box } from "@mui/material";
import * as Y from "yjs";
import throttle from "lodash.throttle";
import { useBindableProperty, useLocale } from "../../../hooks/hooks";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  collectElements,
  isRenderableElement,
  mergeDocumentIntoScene,
  planElementWrite,
  readElementData,
  readStoredViewport,
  resolveInitialViewport,
  snapshotElement,
  storeViewport,
  storageKindOf,
  type ElementData,
  type Viewport,
} from "./canvasSync";

const CANVAS_ORIGIN = "excalidraw";

/**
 * Where the ordering used to live, as a `viewport` key inside the shared
 * `excalidraw_config` map. Nothing writes it any more; it is read once as a
 * fallback so a document that predates the split opens where it was left.
 */
const LEGACY_VIEWPORT_KEY = "viewport";

export class ExcalidrawYjsBinding {
  /**
   * Each element's value as last exchanged with the shared document.
   *
   * This is what makes a field-level merge possible: diffing the scene against
   * the document would report *remote* changes as local ones and echo them
   * straight back.
   */
  private baseline = new Map<string, ElementData>();

  private destroyed = false;

  private readonly onYDocUpdate = (_update: Uint8Array, origin: unknown) => {
    // Our own writes are already in the scene. Re-merging them would rebuild the
    // whole scene for nothing, which is how the old version ended up echoing
    // every update back at the peer.
    if (origin !== CANVAS_ORIGIN) {
      this.tryMergeAndSyncYDocToScene();
    }
  };

  constructor(
    private yDoc: Y.Doc,
    private api: ExcalidrawImperativeAPI,
    /**
     * View-only (the public share link). The binding is still needed to *read*
     * the document into the scene, but nothing may be written back: the editor is
     * opened from a snapshot fetched over HTTP, and `NoteDocument` discards
     * updates in that mode, so a write would look like it worked and then vanish
     * on reload.
     */
    private readOnly = false,
  ) {
    yDoc.on("update", this.onYDocUpdate);

    // The scene is the starting point: it already holds whatever `initialData`
    // loaded, so those values *are* the baseline — as deep copies, because
    // Excalidraw mutates elements in place and an aliased baseline would change
    // along with them, making every diff come back empty.
    this.api
      .getSceneElementsIncludingDeleted()
      .forEach((element) =>
        this.baseline.set(element.id, snapshotElement(element)),
      );

    this.tryMergeAndSyncYDocToScene();
  }

  private getElementsMap() {
    return this.yDoc.getMap("excalidraw_elements") as Y.Map<ExcalidrawElement>;
  }

  private getFilesInYDoc() {
    return this.yDoc.getMap("excalidraw_files") as Y.Map<BinaryFileData>;
  }

  /** Adopt the document's elements into the scene. */
  mergeAndSyncYDocToScene = () => {
    if (this.destroyed) {
      return;
    }

    const sceneFiles = this.api.getFiles();
    const filesToAdd: BinaryFileData[] = [];
    this.getFilesInYDoc().forEach((file, fileId) => {
      if (!sceneFiles[fileId]) {
        filesToAdd.push(file);
      }
    });

    if (filesToAdd.length) {
      this.api.addFiles(filesToAdd);
    }

    const { elements, adopted, skipped } = mergeDocumentIntoScene({
      scene: this.api.getSceneElementsIncludingDeleted(),
      document: this.getElementsMap(),
      baseline: this.baseline,
    });

    for (const [id, element] of adopted) {
      // `adopted` values are already snapshots, but copy again so the baseline
      // cannot alias the array handed to `updateScene`.
      this.baseline.set(id, snapshotElement(element));
    }

    if (skipped.length) {
      console.error(
        `Canvas: dropped ${skipped.length} element(s) the document cannot render.`,
        skipped,
      );
    }

    // NEVER, not EVENTUALLY: this is remote state, so it must not be pushed onto
    // the local undo stack where undo would appear to edit somebody else's work.
    this.api.updateScene({
      // The only place the checked element data becomes Excalidraw's own type:
      // `mergeDocumentIntoScene` has established that every entry has the id and
      // type Excalidraw dispatches on, and the rest of each element came from the
      // document's element map, which only ever held real elements.
      elements: elements as ExcalidrawElement[],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  private tryMergeAndSyncYDocToScene = throttle(() => {
    try {
      this.mergeAndSyncYDocToScene();
    } catch (error) {
      // Excalidraw's own index validation can throw. Letting that escape through
      // `Y.applyUpdate` would leave this client silently following a document it
      // can no longer render, with nothing in the console to say so.
      console.error(
        "Canvas: failed to merge the document into the scene.",
        error,
      );
    }
  }, 1000);

  /** Write the local edits to the document, merged field by field. */
  syncSceneToYDoc() {
    if (this.destroyed || this.readOnly || this.isMidGesture()) {
      // Reconciling mid-gesture would either fight the user (a remote value
      // landing in the shape being dragged) or store a half-finished element.
      // The gesture's own onChange writes the finished result.
      return;
    }

    const elements = this.api.getSceneElementsIncludingDeleted();
    const elementsMap = this.getElementsMap();
    const { fileWrites, fileDeletes } = this.diffFiles(elements);

    // The document is read and planned inside the transaction, so a change that
    // arrived since the last read is merged rather than overwritten: planning
    // from a snapshot taken before the transaction would let a remote edit made
    // meanwhile (including a conversion to per-field storage) be clobbered by a
    // write built from the older value.
    // An empty transaction emits no update, so a pass that finds nothing to
    // store costs nothing and needs no early exit of its own.
    this.yDoc.transact(() => {
      for (const element of elements) {
        if (!isRenderableElement(element)) {
          continue;
        }

        const stored = elementsMap.get(element.id);
        const write = planElementWrite(
          readElementData(stored) ?? undefined,
          element,
          this.baseline.get(element.id),
          storageKindOf(stored),
        );

        if (!write) {
          continue;
        }

        if (write.storage === "fields" && stored instanceof Y.Map) {
          // Already per-field: set only what changed. This is the write that lets
          // two people edit different properties of one shape without either
          // losing the other's work.
          for (const [key, value] of Object.entries(write.fields)) {
            (stored as Y.Map<unknown>).set(key, value);
          }
        } else {
          // First write in per-field form, converting whatever was there. The
          // nested map starts empty, so `write.fields` is the whole element.
          const map = new Y.Map<unknown>();
          for (const [key, value] of Object.entries(write.fields)) {
            map.set(key, value);
          }
          elementsMap.set(element.id, map as unknown as ExcalidrawElement);
        }

        // What this client believes the element is, so the next diff measures
        // the element against itself and finds nothing. Without this the element
        // reads as dirty forever and every throttled pass echoes it back — an
        // endless stream of updates with nobody editing.
        //
        // Deliberately the local element rather than the merged value just
        // written: the merged value can contain fields from a peer that this
        // scene has not adopted yet, and treating those as known would make the
        // next diff report them as a local change and write them back over the
        // peer's version. The merge adopts them instead, since nothing local is
        // pending.
        //
        // A snapshot, because Excalidraw mutates the scene element in place.
        this.baseline.set(
          element.id,
          snapshotElement(element) as unknown as ExcalidrawElement,
        );
      }

      const filesInYDoc = this.getFilesInYDoc();
      for (const file of fileWrites) {
        filesInYDoc.set(file.id, file);
      }
      for (const fileId of fileDeletes) {
        filesInYDoc.delete(fileId);
      }
    }, CANVAS_ORIGIN);
  }

  /**
   * Which embedded images gained or lost their last reference.
   *
   * Images are stored once and referenced by every element that uses them, so a
   * file is only droppable once no element points at it any more.
   */
  private diffFiles(elements: readonly ExcalidrawElement[]) {
    const filesInYDoc = this.getFilesInYDoc();
    const filesInScene = this.api.getFiles();

    const refCounts = new Map<string, number>();
    filesInYDoc.forEach((file) => refCounts.set(file.id, 0));

    for (const element of elements) {
      if (element.type !== "image" || element.isDeleted) {
        continue;
      }
      const fileId = element.fileId;
      if (fileId) {
        refCounts.set(fileId, (refCounts.get(fileId) ?? 0) + 1);
      }
    }

    const fileWrites: BinaryFileData[] = [];
    const fileDeletes: string[] = [];

    refCounts.forEach((count, fileId) => {
      const inDoc = filesInYDoc.get(fileId);
      const inScene = filesInScene[fileId];
      if (count > 0 && !inDoc && inScene) {
        fileWrites.push(inScene);
      } else if (count <= 0 && inDoc) {
        fileDeletes.push(fileId);
      }
    });

    return { fileWrites, fileDeletes };
  }

  private trySyncSceneToYDoc = throttle(() => {
    try {
      this.syncSceneToYDoc();
    } catch (error) {
      console.error(
        "Canvas: failed to write the scene to the document.",
        error,
      );
    }
  }, 1000);

  /**
   * Whether Excalidraw is part-way through a gesture.
   *
   * Read from `AppState` rather than tracked with events so a gesture that is
   * cancelled or interrupted still clears it.
   */
  private isMidGesture(): boolean {
    const state = this.api.getAppState();
    return Boolean(
      state.newElement ||
        state.editingTextElement ||
        state.resizingElement ||
        state.editingLinearElement ||
        state.selectedElementsAreBeingDragged,
    );
  }

  onChange() {
    if (!this.readOnly) {
      this.trySyncSceneToYDoc();
    }
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.yDoc.off("update", this.onYDocUpdate);
    this.tryMergeAndSyncYDocToScene.cancel();
    this.trySyncSceneToYDoc.cancel();
    this.baseline.clear();
  }

  static getConfigMap = (yDoc: Y.Doc) => yDoc.getMap("excalidraw_config");

  static getElementsFromYDoc(yDoc: Y.Doc) {
    return collectElements(
      yDoc.getMap("excalidraw_elements") as Y.Map<unknown>,
    );
  }
}

const ExcalidrawCanvasCore: React.FC<CoreEditorProps> = ({
  client,
  onBind,
  docInstance,
}) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initData, setInitData] = useState<ExcalidrawInitialDataState | null>(
    null,
  );
  /** Held in a ref, not state: `onChange` fires many times a second and must not
   * re-render the editor. */
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  /**
   * `onBind` arrives as a fresh closure on every render of `CommonEditor`, so
   * depending on it would tear the binding down and rebuild it — losing the
   * baseline, which makes the next sync see no local changes to write. Kept in a
   * ref and read at call time instead.
   */
  const onBindRef = useRef(onBind);
  onBindRef.current = onBind;
  const theme = useBindableProperty(client.setting.colorTheme.resultThemeColor);
  const locale = useLocale();
  // `viewMode` is the read-only share link. The scene must not be written there:
  // `NoteDocument` drops those updates, so they would be lost on reload while
  // appearing to work.
  const readOnly = docInstance?.viewMode ?? false;
  const docId = docInstance?.docId ?? "";

  useEffect(() => {
    if (!docInstance) {
      return;
    }

    const onOfflineLoaded = () => {
      const legacy = ExcalidrawYjsBinding.getConfigMap(docInstance.yDoc).get(
        LEGACY_VIEWPORT_KEY,
      );
      const viewport = resolveInitialViewport(
        readStoredViewport(localStorage, docId),
        legacy,
      );

      setInitData({
        elements:
          // The one place the checked element data becomes Excalidraw's own
          // type; see the note where the scene is written back.
          ExcalidrawYjsBinding.getElementsFromYDoc(
            docInstance.yDoc,
          ) as ExcalidrawElement[],
        appState: {
          scrollX: viewport?.x,
          scrollY: viewport?.y,
          zoom: viewport?.zoom
            ? { value: viewport.zoom as NormalizedZoomValue }
            : undefined,
          activeTool: {
            type: "hand" as const,
            customType: null,
            lastActiveTool: null,
            locked: false,
          },
        },
      });
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineLoaded();
      return;
    }

    docInstance.offlineDataLoaded.addValueChangeListener(onOfflineLoaded);
    return () => {
      docInstance.offlineDataLoaded.removeValueChangeListener(onOfflineLoaded);
    };
  }, [docInstance, docId]);

  useEffect(() => {
    if (!docInstance || !api) {
      return;
    }

    docInstance.editor.getOrigin = () => CANVAS_ORIGIN;
    const binding = new ExcalidrawYjsBinding(docInstance.yDoc, api, readOnly);
    bindingRef.current = binding;
    onBindRef.current();
    api.setActiveTool({ type: "hand" });

    const onOfflineData = () => {
      binding.mergeAndSyncYDocToScene();
      docInstance.editor.setLoading(false);
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineData();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineData);
    }

    return () => {
      docInstance.offlineDataLoaded.removeValueChangeListener(onOfflineData);
      binding.destroy();
      if (bindingRef.current === binding) {
        bindingRef.current = null;
      }
    };
  }, [docInstance, api, readOnly]);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        top: "50px",
      }}
    >
      {initData && (
        <Excalidraw
          theme={theme}
          viewModeEnabled={readOnly}
          initialData={initData}
          excalidrawAPI={setApi}
          onChange={() => {
            bindingRef.current?.onChange();
          }}
          onScrollChange={(scrollX, scrollY, zoom) => {
            const viewport: Viewport = {
              x: scrollX,
              y: scrollY,
              zoom: zoom.value,
            };
            storeViewport(localStorage, docId, viewport);
          }}
          UIOptions={{
            canvasActions: {
              export: false,
              saveToActiveFile: false,
              loadScene: false,
              clearCanvas: false,
            },
          }}
          langCode={locale}
        />
      )}
      <hr />
    </Box>
  );
};

export const ExcalidrawCanvas: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={ExcalidrawCanvasCore} />;
};
