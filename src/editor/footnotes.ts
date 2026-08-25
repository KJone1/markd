import type { Editor } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import {
  footnoteDefinitionSchema,
  footnoteReferenceSchema,
} from "@milkdown/kit/preset/gfm";
import { $view } from "@milkdown/kit/utils";

const FLASH_DURATION = 1400;

function labelOf(node: ProseNode): string {
  return node.attrs.label as string;
}

function nodePosition(
  view: EditorView,
  typeName: string,
  label: string,
): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, position) => {
    if (found !== null) return false;
    if (node.type.name !== typeName || node.attrs.label !== label) return true;
    found = position;
    return false;
  });
  return found;
}

function reveal(view: EditorView, typeName: string, label: string): void {
  const position = nodePosition(view, typeName, label);
  if (position === null) return;
  const dom = view.nodeDOM(position);
  if (!(dom instanceof HTMLElement)) return;
  dom.scrollIntoView({ block: "center", behavior: "smooth" });
  dom.dataset.footnoteFlash = "true";
  globalThis.setTimeout(() => {
    delete dom.dataset.footnoteFlash;
  }, FLASH_DURATION);
}

function footnoteReferenceNodeView(
  node: ProseNode,
  view: EditorView,
): NodeView {
  const dom = document.createElement("sup");
  dom.className = "footnote-reference";
  dom.dataset.type = "footnote_reference";
  dom.contentEditable = "false";

  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "footnote-jump";
  dom.append(jump);

  let currentNode = node;
  const render = (): void => {
    const label = labelOf(currentNode);
    dom.dataset.label = label;
    jump.textContent = label;
    jump.title = `Jump to footnote ${label}`;
    jump.setAttribute("aria-label", `Jump to footnote ${label}`);
  };

  jump.addEventListener("click", (event) => {
    event.preventDefault();
    reveal(view, "footnote_definition", labelOf(currentNode));
  });
  render();

  return {
    dom,
    update: (nextNode) => {
      if (nextNode.type !== currentNode.type) return false;
      currentNode = nextNode;
      render();
      return true;
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

function footnoteDefinitionNodeView(
  node: ProseNode,
  view: EditorView,
): NodeView {
  const dom = document.createElement("dl");
  dom.className = "footnote-definition";
  dom.dataset.type = "footnote_definition";

  const term = document.createElement("dt");
  term.contentEditable = "false";
  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "footnote-jump";
  term.append(jump);

  const contentDOM = document.createElement("dd");
  dom.append(term, contentDOM);

  let currentNode = node;
  const render = (): void => {
    const label = labelOf(currentNode);
    dom.dataset.label = label;
    jump.textContent = label;
    jump.title = `Back to footnote ${label} reference`;
    jump.setAttribute("aria-label", `Back to footnote ${label} reference`);
  };

  jump.addEventListener("click", (event) => {
    event.preventDefault();
    reveal(view, "footnote_reference", labelOf(currentNode));
  });
  render();

  return {
    dom,
    contentDOM,
    update: (nextNode) => {
      if (nextNode.type !== currentNode.type) return false;
      currentNode = nextNode;
      render();
      return true;
    },
    stopEvent: (event) => term.contains(event.target as Node),
    ignoreMutation: (mutation) =>
      term.contains(mutation.target) ||
      (mutation.type === "attributes" && mutation.target === dom),
  };
}

export function footnotesFeature(editor: Editor): void {
  editor.use([
    $view(footnoteReferenceSchema.node, () => footnoteReferenceNodeView),
    $view(footnoteDefinitionSchema.node, () => footnoteDefinitionNodeView),
  ].flat());
}
