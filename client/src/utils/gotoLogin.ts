import { getAuthorization, jwtKey } from "./getAuthorization";

export const gotoLogin = (navigator: (url: string) => void) => {
  window.localStorage.removeItem(jwtKey);
  navigator("/login");
};

export const checkJwtAndGotoLogin = (navigator: (url: string) => void) => {
  const auth = getAuthorization();
  if (!auth) {
    gotoLogin(navigator);
  }
  return auth;
};
