import { buildApplicationMenu } from "../desktop/workspace_menu.ts";

Deno.test("Markd menu contains native workspace commands and valid recent folders", () => {
  const menu = buildApplicationMenu([
    "/Users/example/Notes",
    "/Users/example/Docs",
  ]);
  const serialized = JSON.stringify(menu);

  if (serialized.includes('"label":"File"')) {
    throw new Error("File menu must be merged into the Markd menu");
  }

  assertIncludes(serialized, '"label":"Open Folder..."');
  assertIncludes(serialized, '"accelerator":"CmdOrCtrl+O"');
  assertIncludes(serialized, '"label":"Open Recent"');
  assertIncludes(serialized, '"label":"Notes"');
  assertIncludes(serialized, '"label":"Docs"');
  assertIncludes(serialized, '"label":"Save"');
  assertIncludes(serialized, '"accelerator":"CmdOrCtrl+S"');
  assertIncludes(
    serialized,
    '"label":"Save","id":"save","accelerator":"CmdOrCtrl+S","enabled":false',
  );

  const editable = JSON.stringify(buildApplicationMenu([], true));
  assertIncludes(
    editable,
    '"label":"Save","id":"save","accelerator":"CmdOrCtrl+S","enabled":true',
  );

  if (serialized.includes("Clear Menu")) {
    throw new Error("Open Recent must not contain Clear Menu");
  }
});

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(value)} to include ${expected}`);
  }
}
