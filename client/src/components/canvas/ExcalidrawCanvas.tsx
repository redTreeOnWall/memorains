import { CommonEditor, CoreEditorProps } from "../../editor/CommonEditor";
import { IClient } from "../../interface/Client";
import React, { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { Box } from "@mui/material";
import * as Y from "yjs";
import throttle from "lodash.throttle";
import { useBindableProperty } from "../../hooks/hooks";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { currentLan } from "../../internationnalization/utils";

interface Viewport {
  x: number;
  y: number;
  zoom: NormalizedZoomValue;
}

export class ExcalidrawYjsBinding {
  constructor(
    private yDoc: Y.Doc,
    private api: ExcalidrawImperativeAPI,
  ) {
    yDoc.on("update", (_, origin) => {
      if (origin === "excalidraw") {
        return;
      } else {
        this.tryMergeAndSyncYDocToScene();
      }
    });

    this.tryMergeAndSyncYDocToScene();
  }

  private getElementsMap() {
    return this.yDoc.getMap("excalidraw_elements") as Y.Map<ExcalidrawElement>;
    // const excalidrawMap = this.yDoc.getMap("excalidraw");
    // const existElemMap = excalidrawMap.get("elements") as
    //   | Y.Map<ExcalidrawElement>
    //   | undefined;
    // if (existElemMap) {
    //   return existElemMap;
    // } else {
    //   const newElementsMap = new Y.Map<ExcalidrawElement>();
    //   excalidrawMap.set("elements", newElementsMap);
    //   return newElementsMap;
    // }
  }

  private getFilesInYDoc = () => {
    return this.yDoc.getMap("excalidraw_files") as Y.Map<BinaryFileData>;
  };

  static getConfigMap = (yDoc: Y.Doc) => yDoc.getMap("excalidraw_config");

  static getElementsFromYDoc(yDoc: Y.Doc) {
    // TODO encode the element data by proto buf
    const elementMap = yDoc.getMap(
      "excalidraw_elements",
    ) as Y.Map<ExcalidrawElement>;
    const elementList: ExcalidrawElement[] = [];
    elementMap.forEach((e) => {
      elementList.push(e);
    });
    return elementList;
  }

  mergeAndSyncYDocToScene() {
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

    // this.syncSeneToYDoc();
    const exist = this.api.getSceneElementsIncludingDeleted();
    const elemMap = new Map<string, ExcalidrawElement>();
    exist.forEach((e) => {
      elemMap.set(e.id, e);
    });

    this.getElementsMap().forEach((e) => {
      const old = elemMap.get(e.id);
      const newE =
        !!old && old.versionNonce === e.versionNonce ? old : { ...e };
      elemMap.set(newE.id, newE);
    });

    const mergedSortedElements = [...elemMap.values()].sort((a, b) =>
      (a.index ?? "0") < (b.index ?? "0") ? -1 : 1,
    );

    this.api.updateScene({ elements: mergedSortedElements });
  }

  tryMergeAndSyncYDocToScene = throttle(() => {
    this.mergeAndSyncYDocToScene();
  }, 1000);

  syncSeneToYDoc() {
    const updateList: ExcalidrawElement[] = [];
    const removeIdList: string[] = [];

    const elements = this.api.getSceneElementsIncludingDeleted();
    const elementsMap = this.getElementsMap();

    const fileRefCountMap = new Map<string, number>();
    this.getFilesInYDoc().forEach((f) => {
      fileRefCountMap.set(f.id, 0);
    });

    elements.forEach((e) => {
      let element: ExcalidrawElement = e;
      const { versionNonce, id, isDeleted } = element;

      const exist = elementsMap.get(id);

      if (exist && isDeleted) {
        // FIXME
        // removeIdList.push(id);
        // Do not delete , just update, remove useless property
        element = {
          id,
          isDeleted,
          versionNonce,
        } as unknown as ExcalidrawElement;
        // return;
      }

      // TODO update property by property;
      if (
        exist?.versionNonce !== versionNonce &&
        !(exist?.isDeleted && isDeleted)
      ) {
        updateList.push(element);
      }

      if (e.type === "image") {
        const fileId = e.fileId;
        if (fileId) {
          const current = fileRefCountMap.get(fileId) ?? 0;
          if (!isDeleted) {
            fileRefCountMap.set(fileId, current + 1);
          }
        }
      }
    });

    const configMap = ExcalidrawYjsBinding.getConfigMap(this.yDoc);
    const viewport = configMap.get("viewport") as unknown as
      | Viewport
      | undefined;
    const state = this.api.getAppState();

    const x = state.scrollX;
    const y = state.scrollY;
    const zoom = state.zoom.value;
    const newViewport: Viewport = {
      x,
      y,
      zoom,
    };

    const viewportChanged =
      newViewport.x !== viewport?.x ||
      newViewport.y !== viewport?.y ||
      newViewport.zoom !== viewport?.zoom;

    if (updateList.length || removeIdList.length || viewportChanged) {
      this.yDoc.transact(() => {
        updateList.forEach((e) => {
          // TODO only update properties or use protobuf;
          // const exist = this.elementsMap.get(e.id);
          elementsMap.set(e.id, { ...e });
        });

        removeIdList.forEach((id) => {
          // FIXME
          elementsMap.delete(id);
        });

        const filesInYDoc = this.getFilesInYDoc();
        const filesInScene = this.api.getFiles();
        fileRefCountMap.forEach((count, fileId) => {
          const existedYFile = filesInYDoc.get(fileId);
          const existedSceneFile = filesInScene[fileId];
          if (count > 0 && !existedYFile && existedSceneFile) {
            filesInYDoc.set(fileId, existedSceneFile);
          }

          if (count <= 0 && filesInYDoc) {
            filesInYDoc.delete(fileId);
          }
        });

        if (viewportChanged) {
          // viewport
          configMap.set("viewport", newViewport);
        }
      }, "excalidraw");

      if (removeIdList.length) {
        // this.api.updateScene({ elements: this.api.getSceneElements(), commitToHistory: false });
      }
    }
  }

  private trySyncSeneToYDoc = throttle(() => {
    this.syncSeneToYDoc();
  }, 1000);

  onChange() {
    // TODO Ignore cursor event
    this.trySyncSeneToYDoc();
  }
}

const ExcalidrawCanvasCore: React.FC<CoreEditorProps> = ({
  client,
  onBind,
  docInstance,
}) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawYjsBinding | null>(null);
  const theme = useBindableProperty(client.setting.colorTheme.resultThemeColor);
  const [initData, setInitData] = useState<ExcalidrawInitialDataState | null>(
    null,
  );

  useEffect(() => {
    if (!docInstance) {
      return;
    }
    const onOfflineLoaded = () => {
      const config = ExcalidrawYjsBinding.getConfigMap(docInstance.yDoc);
      const viewport = config.get("viewport") as unknown as
        | Viewport
        | undefined;

      setInitData({
        elements: ExcalidrawYjsBinding.getElementsFromYDoc(docInstance.yDoc),
        appState: {
          scrollX: viewport?.x,
          scrollY: viewport?.y,
          zoom: viewport?.zoom
            ? {
                value: viewport.zoom,
              }
            : undefined,
        },
      });
    };
    if (docInstance.offlineDataLoaded.value) {
      onOfflineLoaded();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineLoaded);
      return () => {
        docInstance.offlineDataLoaded.removeValueChangeListener(
          onOfflineLoaded,
        );
      };
    }
  }, [docInstance]);

  useEffect(() => {
    if (!docInstance || !api) {
      return;
    }

    docInstance.editor.getOrigin = () => "excalidraw";
    const newBinding = new ExcalidrawYjsBinding(docInstance.yDoc, api);
    newBinding.onChange();
    setBinding(newBinding);
    onBind();

    const onOfflineData = () => {
      // init data
      newBinding.mergeAndSyncYDocToScene();
      // api.scrollToContent(api.getSceneElements(), {
      //   fitToContent: true,
      // });
      docInstance.editor.setLoading(false);
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineData();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineData);

      return () => {
        docInstance.offlineDataLoaded.removeValueChangeListener(onOfflineData);
      };
    }
  }, [docInstance, api]);

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
          viewModeEnabled={initData === null}
          initialData={initData}
          excalidrawAPI={(api) => {
            setApi(api);
          }}
          onChange={() => {
            binding?.onChange();
          }}
          UIOptions={{
            canvasActions: {
              export: false,
              saveToActiveFile: false,
              loadScene: false,
              clearCanvas: false,
            },
          }}
          langCode={currentLan}
        />
      )}
      <hr />
    </Box>
  );
};

export const ExcalidrawCanvas: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={ExcalidrawCanvasCore} />;
};
