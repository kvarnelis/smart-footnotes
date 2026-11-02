# Smart Footnotes

One set of Markdown footnotes for Obsidian, WordPress, and Word. Insert and renumber footnotes in Obsidian, generate a WordPress footnotes block, and export real Word footnotes with Pandoc.

## Commands

- **Insert footnote** inserts a numbered marker at the cursor, appends its definition, renumbers, and moves the cursor to the definition. Use Editing view.
- **Renumber footnotes** assigns numbers in the order references appear in the document.
- **Refresh WordPress footnotes block** creates or replaces the generated block at the end of the note. If there are no referenced footnotes, it removes the existing block.

Renumbering changes referenced markers and their matching single-line definitions; unreferenced definitions are left alone. A marker referenced more than once stops renumbering with a warning; fix repeated markers manually first. Check for numbering conflicts with unreferenced definitions before renumbering. In the editor, Ctrl-click or Command-click a marker to jump between a reference and its definition.

## WordPress

After editing notes, run **Renumber footnotes**, then **Refresh WordPress footnotes block**. Copy the content into WordPress and check the resulting footnotes block. Refresh the block again after changing footnotes; it does not update automatically.

The block renders single-line definitions with simple `*italic*`, `_italic_`, `**bold**`, backtick code, and HTTP or HTTPS links. HTML is escaped. This is a limited inline subset, not a full Markdown parser; complex or nested formatting may remain literal. WordPress editor behavior should be checked on your site.

## Word export

Install [Pandoc](https://pandoc.org/), then run:

```sh
pandoc -f markdown-markdown_in_html_blocks note.md -o note.docx
```

Pandoc converts the Markdown footnotes into real Word footnotes. The format flag prevents Pandoc from parsing the generated WordPress HTML block as a separate list, which would otherwise duplicate the notes in the document body.

## Installation

Until the plugin is listed in Obsidian, download `main.js`, `manifest.json`, and `styles.css` from a release when available. Place them in your vault's `.obsidian/plugins/smart-footnotes/` directory, reload Obsidian, and enable Smart Footnotes under Community plugins. No release has been published yet.

The plugin is marked as supporting desktop and mobile. Mobile use has not been verified; the modifier-click navigation requires a keyboard or equivalent input.

Screenshot: TODO.

## Development

Run `node test/run.js` with Node.js. No npm dependencies are required.

## License

MIT. See [LICENSE](LICENSE).
