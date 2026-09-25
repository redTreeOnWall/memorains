import { genRandomString } from "../utils/utils";

if (process.env.IS_DEV === "true" && !process.env.SECRET) {
  console.warn(
    "[dev] SECRET is not set, a random secret will be generated and all " +
      "existing tokens will become invalid on every restart. Set SECRET in " +
      "your dev environment to keep tokens valid for scripted testing."
  );
}

const scr = process.env.SECRET || genRandomString();
export const getSecret = () => scr;
