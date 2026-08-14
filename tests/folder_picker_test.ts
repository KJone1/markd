import { pickNativeFolder } from "../desktop/folder_picker.ts";

Deno.test("native folder picker returns the selected POSIX path", async () => {
  const result = await pickNativeFolder(() =>
    Promise.resolve({ success: true, stdout: "/Users/example/Notes\n" })
  );
  if (result !== "/Users/example/Notes") {
    throw new Error(`Unexpected selected path: ${result}`);
  }
});

Deno.test("cancelling the native folder picker returns no path", async () => {
  const result = await pickNativeFolder(() =>
    Promise.resolve({ success: false, stdout: "" })
  );
  if (result !== null) throw new Error(`Unexpected selected path: ${result}`);
});
