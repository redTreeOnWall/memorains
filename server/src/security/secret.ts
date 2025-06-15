import { uuid } from "../utils/utils";

const scr = process.env.SECRET || uuid();
export const getSecret = () => scr;
