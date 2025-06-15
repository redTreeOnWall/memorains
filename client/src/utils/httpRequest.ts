import { getUserServerUrl } from "../const/host";
import {
  ApiNames,
  httpApiMap,
  RequestBodyType,
  ResponseType,
} from "../const/httpApi";
import { S2C_Message } from "../interface/HttpMessage";
import { getAuthorization } from "./getAuthorization";
import { checkJwtAndGotoLogin, gotoLogin } from "./gotoLogin";

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public responseMessage: S2C_Message,
  ) {
    super(message);
  }
}

export type HttpParamType = {
  url: string;
} & ({ method?: "GET" } | { method: "POST"; data: object | undefined });

export const httpRequest = async <T extends S2C_Message = S2C_Message>(
  params: HttpParamType,
  navigator: (url: string) => void,
  needAuthorization = true,
) => {
  let auth: string | undefined = undefined;
  let redirected = false;

  if (needAuthorization) {
    auth = checkJwtAndGotoLogin(navigator)?.authorization;

    if (auth === undefined) {
      redirected = true;
    }
  } else {
    auth = getAuthorization()?.authorization;
  }

  if (redirected) {
    return;
  }

  const data =
    params.method === "POST" ? JSON.stringify(params.data) : undefined;

  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers: {
        "Content-Type": "application/json",
        ...(auth
          ? {
              authorization: auth,
            }
          : undefined),
      },
      body: data,
    });

    const result = (await response.json()) as T;
    if (result.success) {
      return result;
    }

    throw new HttpRequestError(
      `Error happened when request ${params.url}`,
      result,
    );
  } catch (e) {
    if (e instanceof HttpRequestError) {
      if (e.responseMessage.code === "401" && needAuthorization) {
        gotoLogin(navigator);
        return;
      }
      // TODO Handle more errors
      return e.responseMessage as T;
    }
  }
};

// TODO params in url
export const httpRequestWithApi = async <T extends ApiNames>(
  apiName: T,
  requestBody: RequestBodyType<T>,
  navigator: (url: string) => void,
) => {
  return await httpRequest<ResponseType<T>>(
    {
      url: `${getUserServerUrl()}/${httpApiMap[apiName].path}`,
      method: httpApiMap[apiName].method,
      data: requestBody,
    },
    navigator,
    httpApiMap[apiName].needAuthorization,
  );
};
