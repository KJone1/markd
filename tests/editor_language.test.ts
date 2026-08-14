import { describe, expect, it } from "vitest";
import { monacoLanguageForPath } from "../src/editor_language.ts";

describe("monacoLanguageForPath", () => {
  it("selects useful filename and extension modes with plain-text fallback", () => {
    expect(monacoLanguageForPath("src/app.ts")).toBe("typescript");
    expect(monacoLanguageForPath("config/settings.json")).toBe("json");
    expect(monacoLanguageForPath("deploy/app.yaml")).toBe("yaml");
    expect(monacoLanguageForPath("scripts/release.sh")).toBe("shell");
    expect(monacoLanguageForPath("Dockerfile")).toBe("dockerfile");
    expect(monacoLanguageForPath("Makefile")).toBe("makefile");
    expect(monacoLanguageForPath("notes.unknown")).toBe("plaintext");
    expect(monacoLanguageForPath("README")).toBe("plaintext");
  });
});
