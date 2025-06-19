import { genRandomString } from "../utils/utils";

const scr = process.env.SECRET || genRandomString();
export const getSecret = () => scr;
