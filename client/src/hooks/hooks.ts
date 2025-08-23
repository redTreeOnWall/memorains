import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkJwtAndGotoLogin } from "../utils/gotoLogin";
import { httpRequestWithApi } from "../utils/httpRequest";
import { ApiNames, RequestBodyType } from "../const/httpApi";
import { BindableProperty } from "../utils/BindableProperty";

export const useHttpRequest = () => {
  const navigate = useNavigate();

  const request = useCallback(
    async <T extends ApiNames>(apiName: T, requestBody: RequestBodyType<T>) => {
      return await httpRequestWithApi(apiName, requestBody, navigate);
    },
    [navigate],
  );

  return request;
};

export const useCheckJwtAndGotoLogin = (offlineMode: boolean) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (offlineMode) {
      return;
    }
    checkJwtAndGotoLogin(navigate);
  }, [navigate, offlineMode]);
};

export const useBindableProperty = <T>(property: BindableProperty<T>) => {
  const [value, setValue] = useState(property.value);

  useEffect(() => {
    const handleChange = (v: T) => {
      setValue(v);
    };
    property.addValueChangeListener(handleChange);
    handleChange(property.value);
    return () => {
      property.removeValueChangeListener(handleChange);
    };
  }, [property]);

  return value;
};

type ValueOf<P> = P extends BindableProperty<infer V> ? V : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useAllBindableProperties = <P extends BindableProperty<any>[]>(
  ...properties: P
): { [K in keyof P]: ValueOf<P[K]> } => {
  const [list, setList] = useState(
    () => properties.map((p) => p.value) as { [K in keyof P]: ValueOf<P[K]> },
  );

  useEffect(() => {
    const handler = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setList(properties.map((p) => p.value) as any);
    };

    properties.forEach((p) => p.addValueChangeListener(handler));
    return () =>
      properties.forEach((p) => p.removeValueChangeListener(handler));
  }, [properties]);

  return list;
};
