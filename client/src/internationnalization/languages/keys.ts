// The set of every string the UI needs.
//
// Derived from `en` so the reference language cannot drift from the list, and
// so adding a key to `en.ts` is all a new string requires.
import type { en } from "./en";

export type StringKey = keyof typeof en;
