import { defaultValueCtx, type Editor } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { createCollapseToggle } from "./prompt-sections.ts";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
}

interface FrontmatterEntry {
  key: string;
  value: string;
}

interface FrontmatterMarker {
  raw: string;
  entries: FrontmatterEntry[];
}

interface FrontmatterAttrs {
  raw: string;
  entriesJson: string;
}

const MARKER = /^<!--markd-frontmatter:([a-f\d-]+)-(\d+)-->$/;
const markerSecret = crypto.randomUUID();
let markerSequence = 0;
const markers = new Map<string, FrontmatterMarker>();

function registerMarker(marker: FrontmatterMarker): string {
  const id = `${markerSecret}-${markerSequence}`;
  markerSequence += 1;
  markers.set(id, marker);
  return `<!--markd-frontmatter:${id}-->`;
}

function resolveMarker(value: string): FrontmatterMarker | null {
  const match = MARKER.exec(value.trim());
  if (match === null || match[1] !== markerSecret) return null;
  const id = `${match[1]}-${match[2]}`;
  const marker = markers.get(id) ?? null;
  if (marker !== null) {
    queueMicrotask(() => {
      if (markers.get(id) === marker) markers.delete(id);
    });
  }
  return marker;
}

function isDelimiterLine(line: string): boolean {
  return /^---[ \t]*\r?$/.test(line);
}

function parseFrontmatterEntries(content: string): FrontmatterEntry[] {
  const lines = content.split("\n");
  const entries: FrontmatterEntry[] = [];
  let current: FrontmatterEntry | null = null;

  for (const line of lines) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    const indented = /^[ \t]/.test(line);
    if (!indented) {
      const match = /^([^\s:][^:]*):(.*)$/.exec(line);
      if (match !== null) {
        current = { key: match[1]!.trim(), value: match[2]!.trim() };
        entries.push(current);
        continue;
      }
    }

    const continuation = line.trim();
    if (current === null) {
      current = { key: "", value: continuation };
      entries.push(current);
      continue;
    }
    current.value = current.value.length > 0
      ? `${current.value}\n${continuation}`
      : continuation;
  }
  return entries;
}

export function prepareFrontmatterMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  if (lines.length === 0 || !isDelimiterLine(lines[0]!)) return markdown;

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (isDelimiterLine(lines[index]!)) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0) return markdown;

  const raw = lines.slice(0, closingIndex + 1).join("\n");
  const content = lines.slice(1, closingIndex).join("\n");
  const marker = registerMarker({
    raw,
    entries: parseFrontmatterEntries(content),
  });
  return [marker, ...lines.slice(closingIndex + 1)].join("\n");
}

function markerValueFromNode(node: MarkdownNode): string | undefined {
  if (node.type === "html") return node.value;
  if (
    node.type === "paragraph" && node.children?.length === 1 &&
    node.children[0]?.type === "html"
  ) return node.children[0].value;
  return undefined;
}

const frontmatterRemark = $remark(
  "frontmatterRemark",
  () => () => (tree) => {
    const markdownTree = tree as unknown as MarkdownNode;
    const children = markdownTree.children;
    if (children === undefined || children.length === 0) return;
    const value = markerValueFromNode(children[0]!);
    if (value === undefined) return;
    const marker = resolveMarker(value);
    if (marker === null) return;
    children[0] = {
      type: "frontmatter",
      raw: marker.raw,
      entries: marker.entries,
    };
  },
);

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  group: "block",
  content: "",
  atom: true,
  selectable: true,
  attrs: {
    raw: { default: "" },
    entriesJson: { default: "[]" },
  },
  parseDOM: [{
    tag: 'div[data-type="frontmatter"]',
    getAttrs: (dom) => ({
      raw: dom.dataset.frontmatterRaw ?? "",
      entriesJson: dom.dataset.frontmatterEntries ?? "[]",
    }),
  }],
  toDOM: (node) => [
    "div",
    {
      "data-type": "frontmatter",
      "data-frontmatter-raw": node.attrs.raw,
      "data-frontmatter-entries": node.attrs.entriesJson,
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === "frontmatter",
    runner: (state, node, type) => {
      state.addNode(type, {
        raw: node.raw as string,
        entriesJson: JSON.stringify(node.entries ?? []),
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => {
      state.addNode("html", undefined, node.attrs.raw as string);
    },
  },
}));

function frontmatterNodeView(
  node: ProseNode,
  _view: EditorView,
  _getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div");
  dom.className = "prompt-section frontmatter-block";
  dom.dataset.type = "frontmatter";

  const summary = document.createElement("div");
  summary.className = "prompt-section-boundary prompt-section-opening";
  summary.contentEditable = "false";
  const label = document.createElement("span");
  label.className = "prompt-section-name frontmatter-label";
  label.textContent = "metadata";

  const content = document.createElement("div");
  content.className = "prompt-section-content frontmatter-content";
  content.id = `frontmatter-content-${crypto.randomUUID()}`;
  content.contentEditable = "false";

  const collapseToggle = createCollapseToggle({
    initiallyCollapsed: true,
    labelFor: (collapsed) => `${collapsed ? "Expand" : "Collapse"} metadata`,
    elementsToHide: [content],
    onToggle: (collapsed) => {
      dom.dataset.promptCollapsed = String(collapsed);
    },
  });
  collapseToggle.button.setAttribute("aria-controls", content.id);
  summary.append(label, collapseToggle.button);
  dom.append(summary, content);

  let currentNode = node;

  const renderEntries = (): void => {
    content.replaceChildren();
    const attrs = currentNode.attrs as FrontmatterAttrs;
    let entries: FrontmatterEntry[] = [];
    try {
      entries = JSON.parse(attrs.entriesJson) as FrontmatterEntry[];
    } catch {
      entries = [];
    }
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "frontmatter-empty";
      empty.textContent = "No metadata";
      content.append(empty);
      return;
    }
    const list = document.createElement("dl");
    list.className = "frontmatter-entries";
    for (const entry of entries) {
      const key = document.createElement("dt");
      key.className = "frontmatter-key";
      key.textContent = entry.key;
      const value = document.createElement("dd");
      value.className = "frontmatter-value";
      value.textContent = entry.value;
      list.append(key, value);
    }
    content.append(list);
  };

  renderEntries();

  return {
    dom,
    update: (nextNode) => {
      if (nextNode.type !== currentNode.type) return false;
      currentNode = nextNode;
      renderEntries();
      return true;
    },
    stopEvent: (event) => summary.contains(event.target as Node),
    ignoreMutation: () => true,
  };
}

const frontmatterView = $view(frontmatterSchema.node, () => frontmatterNodeView);

export function frontmatterFeature(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(
      defaultValueCtx,
      (value) =>
        typeof value === "string" ? prepareFrontmatterMarkdown(value) : value,
    );
  });
  editor.use([
    frontmatterRemark,
    frontmatterSchema,
    frontmatterView,
  ].flat());
}
