import type { Editor } from "@milkdown/kit/core";
import { $remark } from "@milkdown/kit/utils";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

const LINE_ENDING = /\r?\n|\r/g;

const inlineCodeRemark = $remark(
  "markdInlineCodeRemark",
  () => () => (tree) => {
    const visit = (node: MarkdownNode): void => {
      if (node.type === "inlineCode" && typeof node.value === "string") {
        node.value = node.value.replace(LINE_ENDING, " ");
      }
      node.children?.forEach(visit);
    };
    visit(tree as unknown as MarkdownNode);
  },
);

export function inlineCodeFeature(editor: Editor): void {
  editor.use(inlineCodeRemark);
}
