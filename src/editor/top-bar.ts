import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { commandsCtx, type Editor, editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  hrSchema,
  inlineCodeSchema,
  liftListItemCommand,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  sinkListItemCommand,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  createTable,
  strikethroughSchema,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import type { MarkType, NodeType } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { insertDetailsCommand } from "./html.ts";

export type HeadingLevel = null | 1 | 2 | 3 | 4 | 5 | 6;

export type TopBarActionId =
  | "heading-paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "indent"
  | "outdent"
  | "link"
  | "image"
  | "table"
  | "code-block"
  | "details"
  | "quote"
  | "divider"
  | "browse-files"
  | "copy-path"
  | "open-in-zed";

export type ApplicationTopBarActionId =
  | "browse-files"
  | "copy-path"
  | "open-in-zed";

export type EditorTopBarActionId = Exclude<
  TopBarActionId,
  ApplicationTopBarActionId
>;

export interface TopBarState {
  readonly ready: boolean;
  readonly editable: boolean;
  readonly headingLevel: HeadingLevel;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strikethrough: boolean;
  readonly inlineCode: boolean;
  readonly link: boolean;
  readonly bulletList: boolean;
  readonly orderedList: boolean;
  readonly taskList: boolean;
  readonly codeBlock: boolean;
  readonly quote: boolean;
}

export const DEFAULT_TOP_BAR_STATE: TopBarState = Object.freeze({
  ready: false,
  editable: false,
  headingLevel: null,
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  link: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  codeBlock: false,
  quote: false,
});

function isMarkActive(view: EditorView, markType: MarkType): boolean {
  const { doc, selection, storedMarks } = view.state;
  if (doc.rangeHasMark(selection.from, selection.to, markType)) return true;
  if (storedMarks?.some((mark) => mark.type === markType)) return true;
  if (selection instanceof TextSelection && selection.$cursor) {
    return selection.$cursor.marks().some((mark) => mark.type === markType);
  }
  return false;
}

function selectionAncestors(view: EditorView): Array<{
  type: NodeType;
  attrs: Readonly<Record<string, unknown>>;
}> {
  const { $from } = view.state.selection;
  const ancestors = [];
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    ancestors.push({ type: node.type, attrs: node.attrs });
  }
  return ancestors;
}

export function readTopBarState(ctx: Ctx, view: EditorView): TopBarState {
  const ancestors = selectionAncestors(view);
  const hasNode = (nodeType: NodeType) =>
    ancestors.some((node) => node.type === nodeType);
  const listItem = listItemSchema.type(ctx);
  const selectedListItem = ancestors.find((node) => node.type === listItem);
  const taskList = selectedListItem?.attrs.checked != null;
  const heading = ancestors.find((node) =>
    node.type === headingSchema.type(ctx)
  );
  const level = heading?.attrs.level;
  const headingLevel = typeof level === "number" && level >= 1 && level <= 6
    ? level as Exclude<HeadingLevel, null>
    : null;

  return {
    ready: true,
    editable: view.editable,
    headingLevel,
    bold: isMarkActive(view, strongSchema.type(ctx)),
    italic: isMarkActive(view, emphasisSchema.type(ctx)),
    strikethrough: isMarkActive(view, strikethroughSchema.type(ctx)),
    inlineCode: isMarkActive(view, inlineCodeSchema.type(ctx)),
    link: isMarkActive(view, linkSchema.type(ctx)),
    bulletList: !taskList && hasNode(bulletListSchema.type(ctx)),
    orderedList: !taskList && hasNode(orderedListSchema.type(ctx)),
    taskList,
    codeBlock: hasNode(codeBlockSchema.type(ctx)),
    quote: hasNode(blockquoteSchema.type(ctx)),
  };
}

export type PublishTopBarState = (state: TopBarState) => void;

const topBarStatePluginKey = new PluginKey("MARKD_TOP_BAR_STATE");

export function createTopBarStateFeature(
  publish: PublishTopBarState,
): (editor: Editor) => void {
  return (editor) => {
    editor.use($prose((ctx) =>
      new Plugin({
        key: topBarStatePluginKey,
        view: (view) => {
          let active = true;
          const update = (nextView: EditorView) => {
            if (active) publish(readTopBarState(ctx, nextView));
          };
          update(view);
          return {
            update,
            destroy: () => {
              active = false;
              publish(DEFAULT_TOP_BAR_STATE);
            },
          };
        },
      })
    ));
  };
}

function setHeading(ctx: Ctx, level: HeadingLevel): void {
  const commands = ctx.get(commandsCtx);
  if (level === null) {
    commands.call(setBlockTypeCommand.key, {
      nodeType: paragraphSchema.type(ctx),
    });
    return;
  }
  commands.call(setBlockTypeCommand.key, {
    nodeType: headingSchema.type(ctx),
    attrs: { level },
  });
}

function headingLevelForAction(action: EditorTopBarActionId): HeadingLevel {
  if (action === "heading-paragraph") return null;
  if (action.startsWith("heading-")) {
    return Number(action.slice("heading-".length)) as HeadingLevel;
  }
  throw new Error(`Top-bar action is not a heading action: ${action}`);
}

export function runTopBarAction(
  ctx: Ctx,
  action: EditorTopBarActionId,
): void {
  const commands = ctx.get(commandsCtx);

  if (action.startsWith("heading-")) {
    setHeading(ctx, headingLevelForAction(action));
    return;
  }

  switch (action) {
    case "bold":
      commands.call(toggleStrongCommand.key);
      return;
    case "italic":
      commands.call(toggleEmphasisCommand.key);
      return;
    case "strikethrough":
      commands.call(toggleStrikethroughCommand.key);
      return;
    case "inline-code": {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      if (!state.selection.empty) {
        commands.call(toggleInlineCodeCommand.key);
        return;
      }
      const markType = inlineCodeSchema.type(ctx);
      const transaction = isMarkActive(view, markType)
        ? state.tr.removeStoredMark(markType)
        : state.tr.addStoredMark(markType.create());
      view.dispatch(transaction);
      return;
    }
    case "bullet-list":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: bulletListSchema.type(ctx),
      });
      return;
    case "ordered-list":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: orderedListSchema.type(ctx),
      });
      return;
    case "task-list":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false },
      });
      return;
    case "indent":
      commands.call(sinkListItemCommand.key);
      return;
    case "outdent":
      commands.call(liftListItemCommand.key);
      return;
    case "link": {
      const view = ctx.get(editorViewCtx);
      const markType = linkSchema.type(ctx);
      if (view.state.selection.empty && isMarkActive(view, markType)) {
        view.dispatch(view.state.tr.removeStoredMark(markType));
        return;
      }
      commands.call(toggleLinkCommand.key);
      return;
    }
    case "image":
      commands.call(addBlockTypeCommand.key, {
        nodeType: imageBlockSchema.type(ctx),
      });
      return;
    case "table": {
      const view = ctx.get(editorViewCtx);
      const { from } = view.state.selection;
      commands.call(addBlockTypeCommand.key, {
        nodeType: createTable(ctx, 3, 3),
      });
      commands.call(selectTextNearPosCommand.key, { pos: from });
      return;
    }
    case "code-block":
      commands.call(setBlockTypeCommand.key, {
        nodeType: codeBlockSchema.type(ctx),
      });
      return;
    case "details":
      commands.call(insertDetailsCommand.key);
      return;
    case "quote":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: blockquoteSchema.type(ctx),
      });
      return;
    case "divider":
      commands.call(addBlockTypeCommand.key, {
        nodeType: hrSchema.type(ctx),
      });
      return;
    default:
      throw new Error(`Unsupported editor top-bar action: ${action}`);
  }
}
