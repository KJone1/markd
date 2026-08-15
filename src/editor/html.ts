import type { Editor } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
}

export interface HtmlFeatureConfig {
  resolveImage?: (path: string) => Promise<string> | null | undefined;
}

const RENDERABLE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const RENDERABLE_ATTRIBUTES = new Set([
  "align",
  "alt",
  "colspan",
  "decoding",
  "dir",
  "height",
  "href",
  "lang",
  "loading",
  "media",
  "open",
  "reversed",
  "rowspan",
  "sizes",
  "src",
  "srcset",
  "start",
  "title",
  "type",
  "valign",
  "width",
]);

const BLOCK_CONTAINERS = new Set([
  "blockquote",
  "center",
  "dd",
  "details",
  "div",
  "figure",
  "li",
  "section",
  "td",
  "th",
]);
const URL_ATTRIBUTES = new Set(["href", "src", "srcset"]);
const URL_NOISE = /\s/g;
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
const SAFE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);/i;
const MARKD_MARKER = /^<!--markd-(?:internal|frontmatter):[a-f\d-]+-\d+-->$/;
const FLOW_PARENTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
  "promptSection",
  "htmlSection",
]);

export function isRenderableHtmlTag(name: string): boolean {
  return RENDERABLE_TAGS.has(name.toLowerCase());
}

function isSafeUrl(raw: string): boolean {
  const value = raw.replace(URL_NOISE, "");
  const scheme = SCHEME.exec(value);
  if (scheme === null) return true;
  return SAFE_SCHEMES.has(scheme[1]!.toLowerCase()) ||
    SAFE_DATA_URL.test(value);
}

export function renderableHtml(source: string): DocumentFragment | null {
  const template = document.createElement("template");
  template.innerHTML = source;
  const content = template.content;
  if (content.querySelector("*") === null) return null;
  for (const element of content.querySelectorAll("*")) {
    if (!RENDERABLE_TAGS.has(element.localName)) return null;
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (!RENDERABLE_ATTRIBUTES.has(name)) return null;
      if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) return null;
    }
    if (element.localName === "img" && !element.hasAttribute("alt")) {
      element.setAttribute("alt", "");
    }
  }
  return content;
}

function deferRelativeImages(root: ParentNode): void {
  for (const image of root.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src")!;
    if (source.startsWith("//") || SCHEME.test(source)) continue;
    image.setAttribute("data-markd-src", source);
    image.removeAttribute("src");
  }
}

function resolveDeferredImages(
  root: ParentNode,
  config: HtmlFeatureConfig,
  isCurrent: () => boolean,
): void {
  for (const image of root.querySelectorAll("img[data-markd-src]")) {
    const source = image.getAttribute("data-markd-src")!;
    const resolved = config.resolveImage?.(source);
    if (resolved == null) {
      image.setAttribute("src", source);
      continue;
    }
    void resolved
      .then((url) => {
        if (isCurrent()) image.setAttribute("src", url);
      })
      .catch(() => {});
  }
}

function rawHtmlValue(node: MarkdownNode): string | null {
  if (node.type === "html" && typeof node.value === "string") return node.value;
  const children = node.type === "paragraph" ? node.children : undefined;
  if (children === undefined || children.length === 0) return null;
  const values = children.map((child) =>
    child.type === "html" && typeof child.value === "string"
      ? child.value
      : null
  );
  return values.every((value) => value !== null) ? values.join("\n") : null;
}

const htmlBlockRemark = $remark("markdHtmlBlockRemark", () => () => (tree) => {
  const visit = (node: MarkdownNode): void => {
    const children = node.children;
    if (children === undefined) return;
    if (FLOW_PARENTS.has(node.type)) {
      for (const [index, child] of children.entries()) {
        const value = rawHtmlValue(child);
        if (value === null || MARKD_MARKER.test(value.trim())) continue;
        children[index] = { type: "htmlBlock", value };
      }
    }
    children.forEach(visit);
  };
  visit(tree as unknown as MarkdownNode);
});

export const htmlBlockSchema = $nodeSchema("html_block", () => ({
  group: "block",
  content: "",
  atom: true,
  selectable: true,
  attrs: {
    value: { default: "", validate: "string" },
  },
  parseDOM: [{
    tag: 'div[data-type="html-block"]',
    getAttrs: (dom) => ({ value: dom.dataset.htmlValue ?? "" }),
  }],
  toDOM: (node) => [
    "div",
    {
      "data-type": "html-block",
      "data-html-value": node.attrs.value,
    },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === "htmlBlock",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_block",
    runner: (state, node) => {
      state.openNode("paragraph");
      state.addNode("html", undefined, node.attrs.value as string);
      state.closeNode();
    },
  },
}));

export const htmlSectionSchema = $nodeSchema("html_section", () => ({
  content: "block*",
  group: "block",
  defining: true,
  isolating: true,
  attrs: {
    name: { default: "div", validate: "string" },
    openRaw: { default: "<div>", validate: "string" },
    closeRaw: { default: "</div>", validate: "string" },
  },
  parseDOM: [{
    tag: '[data-type="html-section"]',
    getAttrs: (dom) => ({
      name: dom.dataset.htmlName ?? "div",
      openRaw: dom.dataset.htmlOpen ?? "<div>",
      closeRaw: dom.dataset.htmlClose ?? "</div>",
    }),
  }],
  toDOM: (node) => [
    "div",
    {
      "data-type": "html-section",
      "data-html-name": node.attrs.name,
      "data-html-open": node.attrs.openRaw,
      "data-html-close": node.attrs.closeRaw,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "htmlSection",
    runner: (state, node, type) => {
      state.openNode(type, {
        name: node.name,
        openRaw: node.openRaw,
        closeRaw: node.closeRaw,
      }).next(node.children ?? []).closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_section",
    runner: (state, node) => {
      state.addNode("html", undefined, node.attrs.openRaw as string);
      state.next(node.content);
      state.addNode("html", undefined, node.attrs.closeRaw as string);
    },
  },
}));

function htmlBlockNodeView(config: HtmlFeatureConfig) {
  return (
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    const dom = document.createElement("div");
    dom.className = "html-block";
    dom.dataset.type = "html-block";
    dom.contentEditable = "false";

    const rendered = document.createElement("div");
    rendered.className = "html-block-rendered";
    const source = document.createElement("pre");
    source.className = "html-block-source";
    source.contentEditable = "true";
    source.spellcheck = false;
    source.setAttribute("aria-label", "Edit HTML source");
    dom.append(rendered, source);

    let currentNode = node;
    let editing = false;
    let generation = 0;

    const render = (): void => {
      generation += 1;
      const current = generation;
      const value = currentNode.attrs.value as string;
      const fragment = editing ? null : renderableHtml(value);
      rendered.replaceChildren();
      if (fragment !== null) {
        deferRelativeImages(fragment);
        rendered.append(fragment);
        resolveDeferredImages(
          rendered,
          config,
          () => generation === current && dom.isConnected,
        );
      }
      if (source.textContent !== value) source.textContent = value;
      rendered.hidden = fragment === null;
      source.hidden = fragment !== null;
      dom.dataset.htmlMode = fragment === null ? "source" : "rendered";
    };

    const commit = (): void => {
      const value = source.textContent ?? "";
      editing = false;
      const position = getPos();
      if (position === undefined || value === currentNode.attrs.value) {
        render();
        return;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, { value }),
      );
    };

    rendered.addEventListener("dblclick", () => {
      editing = true;
      render();
      source.focus();
    });
    source.addEventListener("blur", commit);
    source.addEventListener("keydown", (event) => {
      if (event.key === "Escape") source.blur();
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
  };
}

function blockContainer(element: HTMLElement): HTMLElement {
  if (BLOCK_CONTAINERS.has(element.localName)) return element;
  const replacement = document.createElement("div");
  for (const attribute of element.attributes) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  return replacement;
}

function htmlSectionNodeView(node: ProseNode): NodeView {
  const attrs = node.attrs as { name: string; openRaw: string };
  const fragment = renderableHtml(`${attrs.openRaw}</${attrs.name}>`);
  const parsed = fragment?.firstElementChild as HTMLElement | null;
  const element = parsed === null || parsed === undefined
    ? document.createElement("div")
    : blockContainer(parsed);
  element.replaceChildren();
  if (element.localName === "details") element.setAttribute("open", "");
  element.classList.add("html-section");
  element.dataset.type = "html-section";
  element.dataset.htmlName = attrs.name;

  return {
    dom: element,
    contentDOM: element,
    update: (nextNode) => nextNode.sameMarkup(node),
  };
}

export function createHtmlFeature(
  config: HtmlFeatureConfig = {},
): (editor: Editor) => void {
  return (editor) => {
    editor.use([
      htmlBlockRemark,
      $view(htmlBlockSchema.node, () => htmlBlockNodeView(config)),
      $view(htmlSectionSchema.node, () => htmlSectionNodeView),
    ].flat());
  };
}
