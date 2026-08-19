import { type CmdKey, commandsCtx, type Editor } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  liftListItemCommand,
  listItemSchema,
  sinkListItemCommand,
} from "@milkdown/kit/preset/commonmark";
import type { Command, EditorState } from "@milkdown/kit/prose/state";
import { $shortcut } from "@milkdown/kit/utils";

function inListItem(ctx: Ctx, state: EditorState): boolean {
  const listItem = listItemSchema.type(ctx);
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === listItem) return true;
  }
  return false;
}

function listIndentCommand(ctx: Ctx, command: CmdKey<unknown>): Command {
  return (state) => {
    if (!inListItem(ctx, state)) return false;
    ctx.get(commandsCtx).call(command);
    return true;
  };
}

// Beats the crepe indent plugin, whose Tab inserts spaces and always wins.
const listIndentShortcut = $shortcut((ctx) => ({
  Tab: {
    key: "Tab",
    priority: 100,
    onRun: () => listIndentCommand(ctx, sinkListItemCommand.key),
  },
  "Shift-Tab": {
    key: "Shift-Tab",
    priority: 100,
    onRun: () => listIndentCommand(ctx, liftListItemCommand.key),
  },
}));

export function listIndentFeature(editor: Editor): void {
  editor.use(listIndentShortcut);
}
