const PICK_FOLDER_SCRIPT =
  'POSIX path of (choose folder with prompt "Open a folder in Markd")';

export interface FolderPickerCommandResult {
  success: boolean;
  stdout: string;
}

export type FolderPickerCommand = () => Promise<FolderPickerCommandResult>;

export async function pickNativeFolder(
  runCommand: FolderPickerCommand = runAppleScript,
): Promise<string | null> {
  const result = await runCommand();
  if (!result.success) return null;
  const path = result.stdout.trim();
  return path === "" ? null : path;
}

async function runAppleScript(): Promise<FolderPickerCommandResult> {
  const command = new Deno.Command("/usr/bin/osascript", {
    args: ["-e", PICK_FOLDER_SCRIPT],
    stdout: "piped",
    stderr: "null",
  });
  const output = await command.output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout),
  };
}
