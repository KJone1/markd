import {
  defaultValueCtx,
  type Editor,
  editorViewOptionsCtx,
  parserCtx,
} from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  orderedListSchema,
  paragraphSchema,
} from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $prose, $remark, $view } from "@milkdown/kit/utils";
import {
  detailsSummarySchema,
  htmlBlockSchema,
  htmlSectionSchema,
  isRenderableHtmlTag,
  parseDetailsSummary,
} from "./html.ts";

const NAME_SOURCE = "[A-Za-z_][A-Za-z0-9_.:-]*";
const ATTRIBUTE_SOURCE =
  `(?:\\s+${NAME_SOURCE}(?:\\s*=\\s*(?:\"[^\"<]*\"|'[^'<]*'))?)*\\s*`;
const OPENING = new RegExp(
  `^(\\s*)<(${NAME_SOURCE})([^<>]*)>(\\s*)$`,
);
const CLOSING = new RegExp(`^(\\s*)</(${NAME_SOURCE})\\s*>(\\s*)$`);
const ATTRIBUTES = new RegExp(`^${ATTRIBUTE_SOURCE}$`);
const INTERNAL_MARKER = /^<!--markd-internal:([a-f\d-]+)-(\d+)-->$/;
const INTERNAL_MARKER_EMBEDDED = /<!--markd-internal:[a-f\d-]+-\d+-->/g;
const INTERNAL_MARKER_SPLIT = /(<!--markd-internal:[a-f\d-]+-\d+-->)/;
const markerSecret = crypto.randomUUID();
let markerSequence = 0;

type BoundaryKind = "open" | "close";

interface PromptBoundary {
  kind: BoundaryKind;
  name: string;
  raw: string;
  html: boolean;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  name?: string;
  openRaw?: string;
  closeRaw?: string;
  sourceRaw?: string;
  sourceText?: string;
  position?: {
    start: { line: number };
    end: { line: number };
  };
  [key: string]: unknown;
}

interface PromptSectionAttrs {
  name: string;
  openRaw: string;
  closeRaw: string;
}

interface PromptCodeMarker {
  kind: "code";
  raw: string;
  style: "fenced" | "indented";
  value: string;
}

interface PromptParagraphMarker {
  kind: "paragraph";
  id: string;
  sourceLines: string[];
}

type InternalMarker =
  | PromptBoundary
  | PromptCodeMarker
  | PromptParagraphMarker;

const internalMarkers = new Map<string, InternalMarker>();
const markerSources = new Map<string, string>();

function registerMarker(marker: InternalMarker, source = ""): string {
  const id = `${markerSecret}-${markerSequence}`;
  markerSequence += 1;
  internalMarkers.set(id, marker);
  markerSources.set(id, source);
  return `<!--markd-internal:${id}-->`;
}

function resolveMarker(value: string): InternalMarker | null {
  const match = INTERNAL_MARKER.exec(value.trim());
  if (match === null || match[1] !== markerSecret) return null;
  const id = `${match[1]}-${match[2]}`;
  const marker = internalMarkers.get(id) ?? null;
  if (marker !== null) {
    queueMicrotask(() => {
      if (internalMarkers.get(id) === marker) internalMarkers.delete(id);
    });
  }
  return marker;
}

function parseBoundary(raw: string): PromptBoundary | null {
  const closing = CLOSING.exec(raw);
  if (closing !== null) {
    const name = closing[2]!;
    return { kind: "close", name, raw, html: isRenderableHtmlTag(name) };
  }

  const opening = OPENING.exec(raw);
  if (opening === null || !ATTRIBUTES.test(opening[3]!)) return null;
  const name = opening[2]!;
  return { kind: "open", name, raw, html: isRenderableHtmlTag(name) };
}

interface CodeFence {
  character: "`" | "~";
  size: number;
}

function openingFence(line: string): CodeFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return null;
  const run = match[1]!;
  const character = run[0] as CodeFence["character"];
  if (character === "`" && match[2]!.includes("`")) return null;
  return { character, size: run.length };
}

function isClosingFence(line: string, opening: CodeFence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (match === null) return false;
  const run = match[1]!;
  return run[0] === opening.character && run.length >= opening.size;
}

function validBoundaryLines(lines: string[]): Map<number, PromptBoundary> {
  const boundaries = new Map<number, PromptBoundary>();
  const stack: Array<{ boundary: PromptBoundary; index: number }> = [];
  const pending: Array<[number, PromptBoundary]> = [];
  let fence: CodeFence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence !== null) {
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const fenceOpening = openingFence(line);
    if (fenceOpening !== null) {
      fence = fenceOpening;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;

    const boundary = parseBoundary(line);
    if (boundary === null) continue;
    if (boundary.kind === "open") {
      stack.push({ boundary, index });
      continue;
    }

    const opening = stack.at(-1);
    if (opening === undefined || opening.boundary.name !== boundary.name) {
      stack.length = 0;
      pending.length = 0;
      continue;
    }

    stack.pop();
    pending.push([opening.index, opening.boundary], [index, boundary]);
    if (stack.length === 0) {
      for (const [boundaryIndex, matched] of pending) {
        boundaries.set(boundaryIndex, matched);
      }
      pending.length = 0;
    }
  }

  return boundaries;
}

function codeBlockMarkers(lines: string[]): Map<number, string> {
  const replacements = new Map<number, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = openingFence(line);
    if (fence !== null) {
      let end = index + 1;
      for (; end < lines.length; end += 1) {
        if (isClosingFence(lines[end]!, fence)) break;
      }
      const contentEnd = Math.min(end, lines.length);
      const valueLines = lines.slice(index + 1, contentEnd);
      if (valueLines.some((valueLine) => parseBoundary(valueLine) !== null)) {
        const rawEnd = end < lines.length ? end + 1 : lines.length;
        const codeMarker = registerMarker({
          kind: "code",
          raw: lines.slice(index, rawEnd).join("\n"),
          style: "fenced",
          value: valueLines.join("\n"),
        });
        replacements.set(index + 1, `${lines[index + 1]!}${codeMarker}`);
      }
      index = end < lines.length ? end : lines.length;
      continue;
    }
    if (!/^(?: {4}|\t)/.test(line)) continue;

    let end = index;
    while (
      end + 1 < lines.length &&
      (/^(?: {4}|\t)/.test(lines[end + 1]!) || lines[end + 1] === "")
    ) end += 1;
    const blockLines = lines.slice(index, end + 1);
    const valueLines = blockLines.map((blockLine) =>
      blockLine.startsWith("\t") ? blockLine.slice(1) : blockLine.slice(4)
    );
    if (!valueLines.some((valueLine) => parseBoundary(valueLine) !== null)) {
      index = end;
      continue;
    }
    const codeMarker = registerMarker({
      kind: "paragraph",
      id: crypto.randomUUID(),
      sourceLines: lines,
    });
    replacements.set(index, `${line}${codeMarker}`);
    index = end;
  }
  return replacements;
}

export function preparePromptSectionMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const valid = validBoundaryLines(lines);
  const codeMarkers = codeBlockMarkers(lines);
  if (valid.size === 0 && codeMarkers.size === 0) return markdown;
  return lines.map((line, index) => {
    const codeMarker = codeMarkers.get(index);
    if (codeMarker !== undefined) return codeMarker;
    const boundary = valid.get(index);
    return boundary === undefined ? line : registerMarker(boundary, line);
  }).join("\n");
}

export function restoreMarkerSources(markdown: string): string {
  return markdown.replaceAll(
    new RegExp(`<!--markd-internal:${markerSecret}-(\\d+)-->`, "g"),
    (marker, sequence: string) =>
      markerSources.get(`${markerSecret}-${sequence}`) ?? marker,
  );
}

function boundaryFromValue(value: string): PromptBoundary | null {
  const marker = resolveMarker(value);
  return marker?.kind === "open" || marker?.kind === "close" ? marker : null;
}

function isRawHtmlNode(node: MarkdownNode): boolean {
  return node.type === "html" || node.type === "htmlBlock";
}

function splitEmbeddedValue(node: MarkdownNode): MarkdownNode[] | null {
  const value = node.value;
  if (!isRawHtmlNode(node) || typeof value !== "string") return null;
  const pieces = value.split(INTERNAL_MARKER_SPLIT);
  if (
    pieces.length < 2 ||
    !pieces.some((piece) => boundaryFromValue(piece) !== null)
  ) return null;

  const result: MarkdownNode[] = [];
  for (const piece of pieces) {
    if (boundaryFromValue(piece) !== null) {
      result.push({ type: "html", value: piece });
      continue;
    }
    const trimmed = piece.replace(/^\n+|\n+$/g, "");
    if (trimmed.trim() === "") continue;
    result.push({ ...node, value: trimmed, position: undefined });
  }
  return result;
}

function splitInlineBoundaries(node: MarkdownNode): MarkdownNode[] | null {
  const children = node.children;
  if (node.type !== "paragraph" || children === undefined) return null;
  if (children.length < 2) return null;
  if (
    !children.some((child) =>
      typeof child.value === "string" && boundaryFromValue(child.value) !== null
    )
  ) return null;

  const result: MarkdownNode[] = [];
  let buffer: MarkdownNode[] = [];
  const flush = (): void => {
    if (
      buffer.some((child) =>
        child.children !== undefined ||
        (typeof child.value === "string" && child.value.trim() !== "")
      )
    ) result.push({ ...node, children: buffer, position: undefined });
    buffer = [];
  };
  for (const child of children) {
    const value = typeof child.value === "string" ? child.value : "";
    if (boundaryFromValue(value) === null) {
      buffer.push(child);
      continue;
    }
    flush();
    result.push({ type: "html", value });
  }
  flush();
  return result;
}

function splitBoundaryMarkers(node: MarkdownNode): void {
  const children = node.children;
  if (children === undefined) return;
  const expanded = children.flatMap((child) =>
    splitEmbeddedValue(child) ?? [child]
  );
  expanded.forEach(splitBoundaryMarkers);
  node.children = expanded.flatMap((child) =>
    splitInlineBoundaries(child) ?? [child]
  );
}

function restoreBoundaryText(
  node: MarkdownNode,
  boundary: PromptBoundary,
): void {
  const target = isRawHtmlNode(node) ? node : node.children?.[0];
  if (target !== undefined) target.value = boundary.raw;
}

function sentinelFromNode(node: MarkdownNode): PromptBoundary | null {
  let value: string | undefined;
  if (node.type === "html") value = node.value;
  else if (
    node.type === "paragraph" && node.children?.length === 1 &&
    node.children[0]?.type === "html"
  ) value = node.children[0].value;
  if (value === undefined) return null;
  return boundaryFromValue(value);
}

function extractMarkers(
  value: string,
  accept: (marker: InternalMarker) => boolean,
): { value: string; markers: InternalMarker[] } {
  const markers: InternalMarker[] = [];
  const cleaned = value.replace(INTERNAL_MARKER_EMBEDDED, (raw) => {
    const marker = resolveMarker(raw);
    if (marker === null || !accept(marker)) return raw;
    markers.push(marker);
    return "";
  });
  return { value: cleaned, markers };
}

function preserveSourceOwner(
  owner: MarkdownNode,
  marker: PromptParagraphMarker,
): void {
  if (
    owner.type !== "paragraph" && owner.type !== "blockquote" &&
    owner.type !== "list"
  ) return;
  const position = owner.position;
  if (position === undefined) return;
  owner.promptParagraphId = marker.id;
  owner.promptParagraphRaw = marker.sourceLines.slice(
    position.start.line - 1,
    position.end.line,
  ).join("\n");
}

function restoreInternalMarkers(
  node: MarkdownNode,
  ancestors: MarkdownNode[] = [],
): void {
  const owner = ancestors.find((ancestor) => ancestor.type !== "root") ?? node;
  if (typeof node.value === "string") {
    const extracted = extractMarkers(
      node.value,
      (marker) =>
        marker.kind === "paragraph" ||
        (node.type === "code" && marker.kind === "code"),
    );
    node.value = extracted.value;
    for (const marker of extracted.markers) {
      if (marker.kind === "code") {
        node.promptCodeRaw = marker.raw;
        node.promptCodeStyle = marker.style;
        node.promptCodeValue = marker.value;
      } else if (marker.kind !== "paragraph") {
        continue;
      } else if (node.type === "code" && owner === node) {
        const position = node.position;
        if (position === undefined) continue;
        node.promptCodeRaw = marker.sourceLines.slice(
          position.start.line - 1,
          position.end.line,
        ).join("\n");
        node.promptCodeStyle = "indented";
        node.promptCodeValue = extracted.value;
      } else {
        preserveSourceOwner(owner, marker);
      }
    }
  }
  if (node.children === undefined) return;
  node.children.forEach((child) =>
    restoreInternalMarkers(child, [...ancestors, node])
  );
  node.children = node.children.filter((child) =>
    child.type !== "html" || child.value !== ""
  );
}

function groupPromptSections(children: MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const opening = sentinelFromNode(child);
    if (opening?.kind !== "open") {
      if (child.children !== undefined) {
        child.children = groupPromptSections(child.children);
      }
      if (opening !== null) restoreBoundaryText(child, opening);
      result.push(child);
      continue;
    }

    let depth = 0;
    let closingIndex = -1;
    let closing: PromptBoundary | null = null;
    for (
      let candidateIndex = index + 1;
      candidateIndex < children.length;
      candidateIndex += 1
    ) {
      const candidate = sentinelFromNode(children[candidateIndex]!);
      if (candidate?.name !== opening.name) continue;
      if (candidate.kind === "open") depth += 1;
      else if (depth > 0) depth -= 1;
      else {
        closingIndex = candidateIndex;
        closing = candidate;
        break;
      }
    }
    if (closingIndex < 0 || closing === null) {
      restoreBoundaryText(child, opening);
      result.push(child);
      continue;
    }

    const sectionChildren = groupPromptSections(
      children.slice(index + 1, closingIndex),
    );
    if (opening.html && opening.name.toLowerCase() === "details") {
      const summary = markdownDetailsSummary(sectionChildren[0]);
      if (summary !== null) sectionChildren[0] = summary;
    }
    result.push({
      type: opening.html ? "htmlSection" : "promptSection",
      name: opening.name,
      openRaw: opening.raw,
      closeRaw: closing.raw,
      children: sectionChildren,
    });
    index = closingIndex;
  }
  return result;
}

function markdownHtmlValue(node: MarkdownNode | undefined): string | null {
  if (node === undefined) return null;
  if (
    (node.type === "html" || node.type === "htmlBlock") &&
    typeof node.value === "string"
  ) return node.value;
  if (node.type !== "paragraph" || node.children === undefined) return null;
  const values = node.children.map((child) =>
    child.type === "html" && typeof child.value === "string"
      ? child.value
      : null
  );
  return values.length > 0 && values.every((value) => value !== null)
    ? values.join("")
    : null;
}

function markdownDetailsSummary(
  node: MarkdownNode | undefined,
): MarkdownNode | null {
  const source = markdownHtmlValue(node);
  if (source === null) return null;
  const summary = parseDetailsSummary(source);
  if (summary === null) return null;
  return {
    type: "detailsSummary",
    openRaw: summary.openRaw,
    closeRaw: summary.closeRaw,
    sourceRaw: summary.raw,
    sourceText: summary.text,
    children: summary.text === ""
      ? []
      : [{ type: "text", value: summary.text }],
  };
}

const promptSectionRemark = $remark(
  "promptSectionRemark",
  () => () => (tree) => {
    const markdownTree = tree as unknown as MarkdownNode;
    restoreInternalMarkers(markdownTree);
    splitBoundaryMarkers(markdownTree);
    if (markdownTree.children !== undefined) {
      markdownTree.children = groupPromptSections(markdownTree.children);
    }
  },
);

const promptParagraphSchema = paragraphSchema.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        promptParagraphId: { default: "", validate: "string" },
        promptParagraphRaw: { default: "", validate: "string" },
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            promptParagraphId: node.promptParagraphId ?? "",
            promptParagraphRaw: node.promptParagraphRaw ?? "",
          });
          if (node.children) state.next(node.children);
          else state.addText(typeof node.value === "string" ? node.value : "");
          state.closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const raw = node.attrs.promptParagraphRaw as string;
          if (raw.length === 0) {
            schema.toMarkdown.runner(state, node);
            return;
          }
          state.addNode("html", undefined, raw);
        },
      },
    };
  },
);

const promptBlockquoteSchema = blockquoteSchema.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        promptParagraphId: { default: "", validate: "string" },
        promptParagraphRaw: { default: "", validate: "string" },
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            promptParagraphId: node.promptParagraphId ?? "",
            promptParagraphRaw: node.promptParagraphRaw ?? "",
          }).next(node.children).closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const raw = node.attrs.promptParagraphRaw as string;
          if (raw.length === 0) {
            schema.toMarkdown.runner(state, node);
            return;
          }
          state.addNode("html", undefined, raw);
        },
      },
    };
  },
);

const promptBulletListSchema = bulletListSchema.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        promptParagraphId: { default: "", validate: "string" },
        promptParagraphRaw: { default: "", validate: "string" },
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            spread: node.spread ?? false,
            promptParagraphId: node.promptParagraphId ?? "",
            promptParagraphRaw: node.promptParagraphRaw ?? "",
          }).next(node.children).closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const raw = node.attrs.promptParagraphRaw as string;
          if (raw.length === 0) {
            schema.toMarkdown.runner(state, node);
            return;
          }
          state.addNode("html", undefined, raw);
        },
      },
    };
  },
);

const promptOrderedListSchema = orderedListSchema.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        promptParagraphId: { default: "", validate: "string" },
        promptParagraphRaw: { default: "", validate: "string" },
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            spread: node.spread ?? true,
            order: node.start ?? 1,
            promptParagraphId: node.promptParagraphId ?? "",
            promptParagraphRaw: node.promptParagraphRaw ?? "",
          }).next(node.children).closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const raw = node.attrs.promptParagraphRaw as string;
          if (raw.length === 0) {
            schema.toMarkdown.runner(state, node);
            return;
          }
          state.addNode("html", undefined, raw);
        },
      },
    };
  },
);

const promptCodeBlockSchema = codeBlockSchema.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        promptCodeRaw: { default: "", validate: "string" },
        promptCodeStyle: { default: "", validate: "string" },
        promptCodeValue: { default: "", validate: "string" },
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          const value = node.value as string | undefined;
          state.openNode(type, {
            language: node.lang ?? "",
            promptCodeRaw: node.promptCodeRaw ?? "",
            promptCodeStyle: node.promptCodeStyle ?? "",
            promptCodeValue: node.promptCodeValue ?? "",
          });
          if (value) state.addText(value);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const raw = node.attrs.promptCodeRaw as string;
          if (raw.length === 0) {
            schema.toMarkdown.runner(state, node);
            return;
          }
          const value = node.content.firstChild?.text ?? "";
          const originalValue = node.attrs.promptCodeValue as string;
          if (value === originalValue) {
            state.addNode("html", undefined, raw);
            return;
          }
          if (node.attrs.promptCodeStyle === "fenced") {
            schema.toMarkdown.runner(state, node);
            return;
          }
          const indent = raw.startsWith("\t") ? "\t" : "    ";
          state.addNode(
            "html",
            undefined,
            value.split("\n").map((line) => `${indent}${line}`).join("\n"),
          );
        },
      },
    };
  },
);

export const promptSectionSchema = $nodeSchema("prompt_section", () => ({
  content: "block*",
  group: "block",
  defining: true,
  isolating: true,
  attrs: {
    name: { default: "Section", validate: "string" },
    openRaw: { default: "<Section>", validate: "string" },
    closeRaw: { default: "</Section>", validate: "string" },
  },
  parseDOM: [{
    tag: 'div[data-type="prompt-section"]',
    getAttrs: (dom) => ({
      name: dom.dataset.promptName ?? "Section",
      openRaw: dom.dataset.promptOpen ?? "<Section>",
      closeRaw: dom.dataset.promptClose ?? "</Section>",
    }),
  }],
  toDOM: (node) => [
    "div",
    {
      "data-type": "prompt-section",
      "data-prompt-name": node.attrs.name,
      "data-prompt-open": node.attrs.openRaw,
      "data-prompt-close": node.attrs.closeRaw,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "promptSection",
    runner: (state, node, type) => {
      state.openNode(type, {
        name: node.name,
        openRaw: node.openRaw,
        closeRaw: node.closeRaw,
      }).next(node.children ?? []).closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "prompt_section",
    runner: (state, node) => {
      state.addNode("html", undefined, node.attrs.openRaw);
      state.next(node.content);
      state.addNode("html", undefined, node.attrs.closeRaw);
    },
  },
}));

function replaceBoundaryName(raw: string, name: string): string {
  return raw.replace(
    new RegExp(`^(\\s*</?)${NAME_SOURCE}`),
    (_match, prefix: string) => `${prefix}${name}`,
  );
}

function paragraphForBoundary(
  view: EditorView,
  raw: string,
): ProseNode {
  const paragraph = view.state.schema.nodes.paragraph!;
  const html = view.state.schema.nodes.html!;
  return paragraph.create(null, html.create({ value: raw }));
}

export interface CollapseToggle {
  button: HTMLButtonElement;
  isCollapsed: () => boolean;
  refresh: () => void;
}

export function createCollapseToggle(options: {
  initiallyCollapsed: boolean;
  labelFor: (collapsed: boolean) => string;
  elementsToHide: HTMLElement[];
  onToggle?: (collapsed: boolean) => void;
}): CollapseToggle {
  const button = document.createElement("button");
  button.className = "prompt-section-collapse";
  button.type = "button";

  let collapsed = options.initiallyCollapsed;
  const apply = (): void => {
    button.textContent = collapsed ? "Expand" : "Collapse";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", options.labelFor(collapsed));
    for (const element of options.elementsToHide) {
      element.style.display = collapsed ? "none" : "";
    }
    options.onToggle?.(collapsed);
  };

  button.addEventListener("click", () => {
    collapsed = !collapsed;
    apply();
  });
  apply();

  return { button, isCollapsed: () => collapsed, refresh: apply };
}

function promptSectionNodeView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div");
  dom.className = "prompt-section";
  dom.dataset.type = "prompt-section";

  const opening = document.createElement("div");
  opening.className = "prompt-section-boundary prompt-section-opening";
  opening.dataset.promptBoundary = "open";
  opening.contentEditable = "false";
  const openingInput = document.createElement("input");
  openingInput.className = "prompt-section-name";
  openingInput.type = "text";
  openingInput.autocomplete = "off";
  openingInput.spellcheck = false;

  const contentDOM = document.createElement("div");
  contentDOM.className = "prompt-section-content";
  contentDOM.id = `prompt-section-content-${crypto.randomUUID()}`;

  const closing = document.createElement("div");
  closing.className = "prompt-section-boundary prompt-section-closing";
  closing.dataset.promptBoundary = "close";
  closing.contentEditable = "false";

  let currentNode = node;
  const collapseToggle = createCollapseToggle({
    initiallyCollapsed: false,
    labelFor: (collapsed) =>
      `${collapsed ? "Expand" : "Collapse"} ${
        (currentNode.attrs as PromptSectionAttrs).name
      } prompt section`,
    elementsToHide: [contentDOM, closing],
    onToggle: (collapsed) => {
      dom.dataset.promptCollapsed = String(collapsed);
    },
  });
  collapseToggle.button.setAttribute("aria-controls", contentDOM.id);
  opening.append(openingInput, collapseToggle.button);
  dom.append(opening, contentDOM, closing);

  const render = (): void => {
    const attrs = currentNode.attrs as PromptSectionAttrs;
    dom.dataset.promptName = attrs.name;
    openingInput.value = attrs.name;
    const nameWidth = `${Math.min(40, Math.max(7, attrs.name.length + 1))}ch`;
    openingInput.style.width = nameWidth;
    openingInput.setAttribute(
      "aria-label",
      `Rename ${attrs.name} prompt section`,
    );
    collapseToggle.refresh();
  };

  const rename = (name: string): void => {
    const position = getPos();
    if (position === undefined) return;
    const attrs = currentNode.attrs as PromptSectionAttrs;
    const openRaw = replaceBoundaryName(attrs.openRaw, name);
    const closeRaw = replaceBoundaryName(attrs.closeRaw, name);
    if (new RegExp(`^${NAME_SOURCE}$`).test(name)) {
      view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
        name,
        openRaw,
        closeRaw,
      }));
      return;
    }
    const replacement = Fragment.fromArray([
      paragraphForBoundary(view, openRaw),
      ...currentNode.content.content,
      paragraphForBoundary(view, closeRaw),
    ]);
    view.dispatch(
      view.state.tr.replaceWith(
        position,
        position + currentNode.nodeSize,
        replacement,
      ),
    );
  };
  openingInput.addEventListener("input", () => rename(openingInput.value));
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
    stopEvent: (event) =>
      opening.contains(event.target as Node) ||
      closing.contains(event.target as Node),
    ignoreMutation: (mutation) =>
      opening.contains(mutation.target) ||
      closing.contains(mutation.target) ||
      (mutation.type === "attributes" &&
        (mutation.target === contentDOM || mutation.target === dom)),
  };
}

const promptSectionView = $view(
  promptSectionSchema.node,
  () => promptSectionNodeView,
);

function directChildren(
  node: ProseNode,
): Array<{ node: ProseNode; pos: number }> {
  const children: Array<{ node: ProseNode; pos: number }> = [];
  node.forEach((child, offset) => children.push({ node: child, pos: offset }));
  return children;
}

function rawBoundaryBlock(node: ProseNode): PromptBoundary | null {
  if (node.type.name !== "paragraph") return null;
  if (node.childCount === 1 && node.firstChild?.type.name === "html") {
    return parseBoundary(node.firstChild.attrs.value as string);
  }
  return parseBoundary(node.textContent);
}

function proseHtmlValue(node: ProseNode | undefined): string | null {
  if (node === undefined) return null;
  if (node.type.name === "html_block") return node.attrs.value as string;
  if (
    node.type.name === "paragraph" && node.childCount === 1 &&
    node.firstChild?.type.name === "html"
  ) return node.firstChild.attrs.value as string;
  return node.type.name === "paragraph" ? node.textContent : null;
}

function proseDetailsSummary(
  node: ProseNode | undefined,
  view: EditorView,
): ProseNode | null {
  const source = proseHtmlValue(node);
  const summary = source === null ? null : parseDetailsSummary(source);
  const type = view.state.schema.nodes.details_summary;
  if (summary === null || type === undefined) return null;
  return type.create({
    openRaw: summary.openRaw,
    closeRaw: summary.closeRaw,
    sourceRaw: summary.raw,
    sourceText: summary.text,
  }, summary.text === "" ? undefined : view.state.schema.text(summary.text));
}

function conversionTransaction(
  doc: ProseNode,
  view: EditorView,
) {
  const promptType = view.state.schema.nodes.prompt_section;
  if (promptType === undefined) return null;
  const htmlType = view.state.schema.nodes.html_section ?? promptType;
  let transaction = view.state.tr;
  let changed = false;

  const visit = (parent: ProseNode, contentStart: number): void => {
    const children = directChildren(parent);
    const stack: Array<{ index: number; boundary: PromptBoundary }> = [];
    const pairs: Array<
      {
        open: number;
        close: number;
        opening: PromptBoundary;
        closing: PromptBoundary;
      }
    > = [];
    for (let index = 0; index < children.length; index += 1) {
      const boundary = rawBoundaryBlock(children[index]!.node);
      if (boundary === null) continue;
      if (boundary.kind === "open") stack.push({ index, boundary });
      else {
        const opening = stack.at(-1);
        if (opening === undefined || opening.boundary.name !== boundary.name) {
          stack.length = 0;
          pairs.length = 0;
          continue;
        }
        stack.pop();
        pairs.push({
          open: opening.index,
          close: index,
          opening: opening.boundary,
          closing: boundary,
        });
      }
    }

    const leafPairs = pairs.filter((pair) =>
      !pairs.some((nested) =>
        nested.open > pair.open && nested.close < pair.close
      )
    );
    for (const pair of [...leafPairs].reverse()) {
      const openChild = children[pair.open]!;
      const closeChild = children[pair.close]!;
      const start = contentStart + openChild.pos;
      const end = contentStart + closeChild.pos + closeChild.node.nodeSize;
      const innerNodes = children.slice(pair.open + 1, pair.close).map(
        (item) => item.node,
      );
      if (
        pair.opening.html &&
        pair.opening.name.toLowerCase() === "details"
      ) {
        const summary = proseDetailsSummary(innerNodes[0], view);
        if (summary !== null) innerNodes[0] = summary;
      }
      const inner = Fragment.fromArray(innerNodes);
      transaction = transaction.replaceWith(
        start,
        end,
        (pair.opening.html ? htmlType : promptType).create({
          name: pair.opening.name,
          openRaw: pair.opening.raw,
          closeRaw: pair.closing.raw,
        }, inner),
      );
      changed = true;
    }

    if (changed) return;
    parent.forEach((child, offset) => {
      if (
        child.type.name === "prompt_section" ||
        child.type.name === "html_section"
      ) {
        visit(child, contentStart + offset + 1);
      }
    });
  };
  visit(doc, 0);
  return changed ? transaction : null;
}

function changedPromptSourceTransaction(
  oldDoc: ProseNode,
  view: EditorView,
) {
  const originals = new Map<string, ProseNode[]>();
  oldDoc.descendants((node) => {
    const id = node.attrs.promptParagraphId as string | undefined;
    if (!id) return;
    const nodes = originals.get(id) ?? [];
    nodes.push(node);
    originals.set(id, nodes);
  });

  let transaction = view.state.tr;
  let changed = false;
  view.state.doc.descendants((node, position) => {
    const id = node.attrs.promptParagraphId as string | undefined;
    const raw = node.attrs.promptParagraphRaw as string | undefined;
    if (!id || !raw) return;
    const prior = originals.get(id);
    if (
      prior === undefined || prior.some((item) => item.content.eq(node.content))
    ) {
      return;
    }
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      promptParagraphId: "",
      promptParagraphRaw: "",
    });
    changed = true;
  });
  return changed ? transaction : null;
}

const promptSectionEditing = $prose(() =>
  new Plugin({
    appendTransaction: (transactions, oldState, newState) => {
      if (
        !transactions.some((transaction) => transaction.docChanged)
      ) return null;
      const fakeView = { state: newState } as EditorView;
      const paragraphTransaction = changedPromptSourceTransaction(
        oldState.doc,
        fakeView,
      );
      if (paragraphTransaction !== null) return paragraphTransaction;
      return conversionTransaction(newState.doc, fakeView);
    },
  })
);

export function promptSectionsFeature(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(
      defaultValueCtx,
      (value) =>
        typeof value === "string" ? preparePromptSectionMarkdown(value) : value,
    );
    ctx.update(editorViewOptionsCtx, (previous) => ({
      ...previous,
      handlePaste: (view, event, slice) => {
        const markdown = event.clipboardData?.getData("text/plain") ?? "";
        const prepared = preparePromptSectionMarkdown(markdown);
        if (prepared !== markdown) {
          const parsed = ctx.get(parserCtx)(prepared);
          view.dispatch(
            view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)),
          );
          return true;
        }
        return previous.handlePaste?.(view, event, slice) ?? false;
      },
    }));
  });
  editor.use([
    promptSectionRemark,
    promptParagraphSchema,
    promptBlockquoteSchema,
    promptBulletListSchema,
    promptOrderedListSchema,
    promptCodeBlockSchema,
    promptSectionSchema,
    promptSectionView,
    promptSectionEditing,
    htmlBlockSchema,
    detailsSummarySchema,
    htmlSectionSchema,
  ].flat());
}
