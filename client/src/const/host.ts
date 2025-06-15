export const serverUrl = `http://localhost:8000/doc/server`;
export const clientUrl = `http://localhost/3000/doc/client`;
export const getWssUrl = (port: number) => `ws://localhost:${port}/ws`;

export const isDev = () => import.meta.env.DEV;

export const isElectron = import.meta.env.VITE_BUILD_ELECTRON === "true";

export const basePath = isElectron ? "./" : "doc/client";

export const defaultAppHost = "note.lirunlong.com";
// TODO electron's host
const appHost = localStorage.getItem("memo_note_host") ?? "note.lirunlong.com";

export const getAppHost = () => appHost;

export const getUserServerUrl = () => {
  if (isDev()) {
    return `http://localhost:8000/doc/server`;
  }

  // FIXME can be config by user;
  if (location.protocol === "http:" || location.protocol === "https:") {
    return `${location.origin}/doc/server`;
  }

  // FIXME Electron's host should be config by user;
  return `https://${appHost}/doc/server`;
};

export const getWsServerUrl = (port: number) => {
  if (isDev()) {
    return `ws://localhost:${port}/doc/websocket/port`;
  }

  if (location.protocol === "https:") {
    return `wss://${location.host}/doc/websocket/port_${port}`;
  } else if (location.protocol === "http:") {
    return `ws://${location.host}/doc/websocket/port_${port}`;
  }

  return `wss://${appHost}/doc/websocket/port_${port}`;
};

export const getClientUrl = () => {
  if (isDev()) {
    return `http://localhost:8000/doc/client`;
  }
  return `https://note.lirunlong.com/doc/client`;
};
