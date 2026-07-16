"use strict";

const { MarkdownView, Plugin, Notice } = require("obsidian");

let Decoration;
let ViewPlugin;
let RangeSetBuilder;

try {
  ({ Decoration, ViewPlugin } = require("@codemirror/view"));
  ({ RangeSetBuilder } = require("@codemirror/state"));
} catch (_error) {
  Decoration = null;
  ViewPlugin = null;
  RangeSetBuilder = null;
}

const FOOTNOTE_REF_RE = /\[\^([^\]\s]+)\]/g;
const FOOTNOTE_DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const WORDPRESS_FOOTNOTES_START = "<!-- wp:footnotes -->";
const WORDPRESS_FOOTNOTES_END = "<!-- /wp:footnotes -->";

function createTempFootnoteId() {
  return `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function replaceAt(value, from, to, replacement) {
  return value.slice(0, from) + replacement + value.slice(to);
}

function findFootnotesBlock(source) {
  const start = source.indexOf(WORDPRESS_FOOTNOTES_START);
  const end = source.indexOf(WORDPRESS_FOOTNOTES_END);

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return { start, end: end + WORDPRESS_FOOTNOTES_END.length };
}

function parseDefinitions(source) {
  const definitions = new Map();

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(FOOTNOTE_DEF_RE);
    if (match) {
      definitions.set(match[1], match[2]);
    }
  }

  return definitions;
}

function collectReferenceOrder(source) {
  const order = [];
  const definitions = parseDefinitions(source);
  let nextNumber = 1;

  for (const line of source.split(/\r?\n/)) {
    const definition = line.match(FOOTNOTE_DEF_RE);
    const searchable = definition ? line.slice(definition[0].length) : line;
    let match;
    FOOTNOTE_REF_RE.lastIndex = 0;

    while ((match = FOOTNOTE_REF_RE.exec(searchable)) !== null) {
      const id = match[1];
      if (definitions.has(id)) {
        order.push({ oldId: id, newId: String(nextNumber++) });
      }
    }
  }

  return order;
}

function collectFootnoteOrder(source) {
  return collectReferenceOrder(source).map((item) => item.oldId);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renumberFootnotes(source) {
  const definitions = parseDefinitions(source);
  const referenceOrder = collectReferenceOrder(source);
  const occurrenceCounts = new Map();
  const inserted = new Map();

  for (const item of referenceOrder) {
    occurrenceCounts.set(item.oldId, (occurrenceCounts.get(item.oldId) || 0) + 1);
  }

  const repeated = [...occurrenceCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (repeated.length > 0) {
    new Notice(`Repeated footnote marker(s): ${repeated.map((id) => `[^${id}]`).join(", ")}. Fix manually; not renumbered.`);
    return { source, inserted, repeated };
  }

  const map = new Map(referenceOrder.map((item) => [item.oldId, item.newId]));
  if (map.size === 0) {
    return { source, inserted, repeated: [] };
  }

  const renumbered = source.replace(FOOTNOTE_REF_RE, (full, id) => {
    const next = map.get(id);
    return next ? `[^${next}]` : full;
  });

  const output = [];
  for (const line of renumbered.split(/\r?\n/)) {
    const definition = line.match(FOOTNOTE_DEF_RE);
    if (!definition) {
      output.push(line);
      continue;
    }

    const oldId = definition[1];
    const body = definition[2];
    const newId = map.get(oldId);

    if (newId) {
      output.push(`[^${newId}]: ${body}`);
      inserted.set(oldId, newId);
    } else {
      output.push(line);
    }
  }

  return { source: output.join("\n"), inserted, repeated: [] };
}

function buildWordPressFootnotes(source) {
  const { source: renumbered } = renumberFootnotes(source);
  const order = collectFootnoteOrder(renumbered);
  const definitions = parseDefinitions(renumbered);

  if (order.length === 0) {
    return "";
  }

  const items = order
    .map((id) => `<li id="fn-${escapeHtml(id)}">${escapeHtml(definitions.get(id) || "")}</li>`)
    .join("\n");

  return `${WORDPRESS_FOOTNOTES_START}\n<ol class="wp-block-footnotes">\n${items}\n</ol>\n${WORDPRESS_FOOTNOTES_END}`;
}


function findFootnoteTokenAtOffset(source, offset) {
  let match;
  FOOTNOTE_REF_RE.lastIndex = 0;

  while ((match = FOOTNOTE_REF_RE.exec(source)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start - 1 && offset <= end + 1) {
      const lineStart = source.lastIndexOf("\n", start) + 1;
      const lineEndIndex = source.indexOf("\n", start);
      const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
      const line = source.slice(lineStart, lineEnd);
      const definition = line.match(FOOTNOTE_DEF_RE);
      return {
        id: match[1],
        start,
        end,
        isDefinition: Boolean(definition && lineStart === start),
      };
    }
  }

  return null;
}

function findDefinitionOffset(source, id) {
  const marker = `[^${id}]:`;
  const lines = source.split(/\r?\n/);
  let offset = 0;

  for (const line of lines) {
    if (line.startsWith(marker)) {
      return offset + marker.length + (line[marker.length] === " " ? 1 : 0);
    }
    offset += line.length + 1;
  }

  return -1;
}

function findFirstReferenceOffset(source, id) {
  let match;
  FOOTNOTE_REF_RE.lastIndex = 0;

  while ((match = FOOTNOTE_REF_RE.exec(source)) !== null) {
    if (match[1] !== id) {
      continue;
    }

    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineEndIndex = source.indexOf("\n", match.index);
    const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
    const line = source.slice(lineStart, lineEnd);
    const definition = line.match(FOOTNOTE_DEF_RE);

    if (!(definition && lineStart === match.index)) {
      return match.index;
    }
  }

  return -1;
}

function getOffsetFromMouseEvent(editor, event) {
  const cm = editor && editor.cm;
  if (!cm) {
    return null;
  }

  if (typeof cm.posAtCoords === "function") {
    const result = cm.posAtCoords({ x: event.clientX, y: event.clientY });
    if (typeof result === "number") {
      return result;
    }
    if (result && typeof editor.posToOffset === "function") {
      return editor.posToOffset({ line: result.line, ch: result.ch });
    }
  }

  if (typeof cm.coordsChar === "function" && typeof editor.posToOffset === "function") {
    const result = cm.coordsChar({ left: event.clientX, top: event.clientY });
    if (result) {
      return editor.posToOffset({ line: result.line, ch: result.ch });
    }
  }

  return null;
}

function updateWordPressFootnotes(source) {
  const block = buildWordPressFootnotes(source);
  const existing = findFootnotesBlock(source);

  if (!block) {
    return existing ? replaceAt(source, existing.start, existing.end, "").trimEnd() : source;
  }

  if (existing) {
    return replaceAt(source, existing.start, existing.end, block);
  }

  return `${source.trimEnd()}\n\n${block}\n`;
}

function selectionTouchesRange(selection, from, to) {
  for (const range of selection.ranges) {
    if (range.empty) {
      if (range.from > from && range.from < to) {
        return true;
      }
      continue;
    }

    if (range.from < to && range.to > from) {
      return true;
    }
  }

  return false;
}

function isFootnoteDefinitionMarker(doc, from) {
  const line = doc.lineAt(from);
  return from === line.from && FOOTNOTE_DEF_RE.test(line.text);
}

function buildEditorFootnoteRefDecorations(view) {
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;

  for (const visibleRange of view.visibleRanges) {
    const text = doc.sliceString(visibleRange.from, visibleRange.to);
    const refRegex = /\[\^([^\]\s]+)\]/g;
    let match;

    while ((match = refRegex.exec(text)) !== null) {
      const from = visibleRange.from + match.index;
      const to = from + match[0].length;

      if (from > 0 && doc.sliceString(from - 1, from) === "\\") {
        continue;
      }

      if (isFootnoteDefinitionMarker(doc, from)) {
        continue;
      }

      if (selectionTouchesRange(view.state.selection, from, to)) {
        continue;
      }

      builder.add(from, from + 2, Decoration.replace({}));
      builder.add(from + 2, to - 1, Decoration.mark({ class: "uuid-footnote-editor-ref" }));
      builder.add(to - 1, to, Decoration.replace({}));
    }
  }

  return builder.finish();
}

function createEditorFootnoteRefExtension() {
  if (!Decoration || !ViewPlugin || !RangeSetBuilder) {
    return null;
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildEditorFootnoteRefDecorations(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildEditorFootnoteRefDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    }
  );
}

module.exports = class SmartFootnotesPlugin extends Plugin {
  async onload() {
    const editorFootnoteRefExtension = createEditorFootnoteRefExtension();
    if (editorFootnoteRefExtension) {
      this.registerEditorExtension(editorFootnoteRefExtension);
    }

    this.addCommand({
      id: "insert-numbered-footnote",
      name: "Insert numbered footnote",
      checkCallback: (checking) => this.runInsertFootnoteCommand(checking),
    });

    this.addCommand({
      id: "insert-footnote",
      name: "Insert footnote",
      checkCallback: (checking) => this.runInsertFootnoteCommand(checking),
    });

    this.addCommand({
      id: "renumber-footnotes",
      name: "Renumber footnotes",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;

        if (!checking) {
          const editor = view.editor;
          const cursor = editor.getCursor();
          editor.setValue(renumberFootnotes(editor.getValue()).source);
          editor.setCursor(cursor);
          new Notice("Footnotes renumbered");
        }

        return true;
      },
    });

    this.addCommand({
      id: "refresh-wordpress-footnotes",
      name: "Refresh WordPress footnotes block",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;

        if (!checking) {
          const editor = view.editor;
          editor.setValue(updateWordPressFootnotes(editor.getValue()));
          new Notice("WordPress footnotes refreshed");
        }

        return true;
      },
    });

    this.registerDomEvent(document, "mousedown", (event) => this.handleFootnoteMetaClick(event));
  }


  handleFootnoteMetaClick(event) {
    if (event.defaultPrevented || event.button !== 0 || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".cm-editor")) {
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    const editor = view.editor;
    const offset = getOffsetFromMouseEvent(editor, event);
    if (offset === null || offset === undefined) {
      return;
    }

    const source = editor.getValue();
    const token = findFootnoteTokenAtOffset(source, offset);
    if (!token) {
      return;
    }

    const destination = token.isDefinition
      ? findFirstReferenceOffset(source, token.id)
      : findDefinitionOffset(source, token.id);

    if (destination === -1) {
      new Notice(`No matching footnote ${token.isDefinition ? "reference" : "definition"} for [^${token.id}]`);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.jumpToOffset(editor, destination);
  }

  jumpToOffset(editor, offset) {
    if (typeof editor.offsetToPos !== "function") {
      return;
    }

    const pos = editor.offsetToPos(offset);
    editor.setCursor(pos);

    if (typeof editor.scrollIntoView === "function") {
      try {
        editor.scrollIntoView({ from: pos, to: pos }, true);
      } catch (_error) {
        try {
          editor.scrollIntoView({ from: pos, to: pos });
        } catch (_ignored) {}
      }
    }

    if (editor.cm && typeof editor.cm.focus === "function") {
      editor.cm.focus();
    }
  }

  runInsertFootnoteCommand(checking) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return false;

    if (!checking) {
      if (typeof view.getMode === "function" && view.getMode() !== "source") {
        new Notice("Switch to Editing view, place the cursor, then run Insert footnote again.");
        return true;
      }

      if (!view.editor || typeof view.editor.getCursor !== "function") {
        new Notice("No active Markdown editor found.");
        return true;
      }

      this.insertFootnote(view.editor);
    }

    return true;
  }

  insertFootnote(editor) {
    const tempId = createTempFootnoteId();
    const marker = `[^${tempId}]`;
    const cursor = editor.getCursor();

    editor.replaceRange(marker, cursor);

    let content = editor.getValue().trimEnd();
    const block = findFootnotesBlock(content);
    const definition = `\n\n[^${tempId}]: `;

    if (block) {
      content = replaceAt(content, block.start, block.start, definition);
    } else {
      content = `${content}${definition}`;
    }

    const result = renumberFootnotes(content);
    const newNumber = result.inserted.get(tempId);
    editor.setValue(result.source);

    if (newNumber) {
      const lines = result.source.split(/\r?\n/);
      const target = `[^${newNumber}]: `;
      const line = lines.findIndex((value) => value.startsWith(target));
      if (line !== -1) {
        editor.setCursor({ line, ch: target.length });
        return;
      }
    }

    editor.setCursor(cursor);
  }
};
