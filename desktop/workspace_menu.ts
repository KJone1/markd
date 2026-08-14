import { basename } from "node:path";

export type ApplicationMenuItem =
  | {
    item: {
      label: string;
      id?: string;
      accelerator?: string;
      enabled: boolean;
    };
  }
  | { submenu: { label: string; items: ApplicationMenuItem[] } }
  | "separator"
  | { role: { role: string } };

export function buildApplicationMenu(
  recentWorkspaces: readonly string[],
  saveEnabled = false,
): ApplicationMenuItem[] {
  const recentItems: ApplicationMenuItem[] = recentWorkspaces.map(
    (path, index) => ({
      item: {
        label: basename(path),
        id: `open-recent:${index}`,
        enabled: true,
      },
    }),
  );

  return [
    {
      submenu: {
        label: "Markd",
        items: [
          { role: { role: "quit" } },
        ],
      },
    },
    {
      submenu: {
        label: "File",
        items: [
          {
            item: {
              label: "Open Folder...",
              id: "open-folder",
              accelerator: "CmdOrCtrl+O",
              enabled: true,
            },
          },
          {
            submenu: {
              label: "Open Recent",
              items: recentItems,
            },
          },
          "separator",
          {
            item: {
              label: "Save",
              id: "save",
              accelerator: "CmdOrCtrl+S",
              enabled: saveEnabled,
            },
          },
          "separator",
          { role: { role: "close" } },
        ],
      },
    },
    {
      submenu: {
        label: "Edit",
        items: [
          { role: { role: "undo" } },
          { role: { role: "redo" } },
          "separator",
          { role: { role: "cut" } },
          { role: { role: "copy" } },
          { role: { role: "paste" } },
          { role: { role: "selectAll" } },
        ],
      },
    },
  ];
}
