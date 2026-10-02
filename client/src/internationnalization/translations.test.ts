/**
 * Guards the translation files.
 *
 * A translation is the one kind of change that looks correct in review and is
 * wrong in production: the English source reads fine, the structure typechecks,
 * and the mistake is a renamed `{placeholder}` (which makes `string-format`
 * throw), a dropped key (a blank label), or a value left in English (a half
 * translated screen). None of those are visible from the diff, and all of them
 * are cheap to check mechanically.
 *
 * This suite is the check. It is deliberately not a "does it read well" test —
 * that needs a speaker of each language — so it verifies what can be verified.
 */
import { describe, expect, it } from "vitest";
import { en } from "./languages/en";
import { supportedLanguages } from "./utils";
import type { StringKey } from "./languages/keys";

const keys = Object.keys(en) as StringKey[];

const placeholders = (text: string) =>
  (text.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();

describe("translations", () => {
  it("ships at least one language besides the reference", () => {
    expect(supportedLanguages.length).toBeGreaterThan(1);
  });

  for (const { code, strings, label } of supportedLanguages) {
    describe(`${code} (${label})`, () => {
      it("covers every key", () => {
        expect(Object.keys(strings).sort()).toEqual([...keys].sort());
      });

      it("has no empty or whitespace-only value", () => {
        for (const key of keys) {
          expect(
            strings[key]?.trim().length,
            `"${key}" is empty`,
          ).toBeGreaterThan(0);
        }
      });

      it("keeps every placeholder of the reference string", () => {
        // A renamed or dropped placeholder is the dangerous one: `string-format`
        // throws when it cannot fill a `{name}`, and the call site is bare
        // `i18n(...)` inside `Format(...)`, so it fails at the moment a user
        // opens that dialog.
        for (const key of keys) {
          expect(
            placeholders(strings[key]),
            `placeholders of "${key}"`,
          ).toEqual(placeholders(en[key]));
        }
      });

      it("does not re-indent or re-space a placeholder", () => {
        for (const key of keys) {
          for (const token of placeholders(en[key])) {
            expect(
              strings[key],
              `"${key}" must contain ${token} verbatim`,
            ).toContain(token);
          }
        }
      });

      it.skipIf(strings === en)("is actually translated", () => {
        // Catches a file copied from `en` and never translated.
        //
        // Only *sentences* are checked, not every string: a single word is often
        // the same in two languages because the language borrowed it — "Chat",
        // "Canvas", "Gantt", "Journal" and "Offline" are correct German and French
        // as they stand, and flagging them would mean maintaining an allowlist
        // that could just as easily hide a real miss. A whole sentence that is
        // still English, however, is never a cognate.
        const untranslated = keys.filter(
          (key) => strings[key] === en[key] && en[key].length > 20,
        );

        expect(
          untranslated,
          `${code} still has ${untranslated.length} English sentences`,
        ).toEqual([]);
      });
    });
  }
});
