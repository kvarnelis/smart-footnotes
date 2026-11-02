"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const code = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const notices = [];
const context = { module: { exports: {} }, require(name) {
  if (name === "obsidian") return { Plugin: class {}, Notice: class { constructor(message) { notices.push(message); } }, MarkdownView: class {} };
  if (name.startsWith("@codemirror/")) throw new Error("Not available in tests");
  throw new Error(`Unexpected dependency: ${name}`);
}};
vm.runInNewContext(code + "\nmodule.exports.testAPI = { renumberFootnotes, buildWordPressFootnotes, updateWordPressFootnotes };", context);
const { renumberFootnotes, buildWordPressFootnotes, updateWordPressFootnotes } = context.module.exports.testAPI;
if (process.argv[2] === "--sample") {
  const source = "First[^alpha] and second[^beta].\n\n[^alpha]: First sample note.\n[^beta]: Second sample note.\n";
  process.stdout.write(updateWordPressFootnotes(source));
  process.exit(0);
}
let failed = 0;
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); } }
test("renumber existing and new notes in reference order", () => {
  const source = "First[^2] then new[^new-abc] then last[^1].\n\n[^1]: Last note\n[^2]: First note\n[^new-abc]: New note";
  assert.equal(renumberFootnotes(source).source, "First[^1] then new[^2] then last[^3].\n\n[^3]: Last note\n[^1]: First note\n[^2]: New note");
});
test("WordPress renders safe inline formatting and escapes HTML", () => {
  const source = "Text[^a].\n\n[^a]: *italic* _other_ **bold** `code` [site](https://example.org/?a=1&b=2) <script>alert(1)</script>";
  assert.equal(buildWordPressFootnotes(source), '<!-- wp:footnotes -->\n<ol class="wp-block-footnotes">\n<li id="fn-1"><em>italic</em> <em>other</em> <strong>bold</strong> <code>code</code> <a href="https://example.org/?a=1&amp;b=2">site</a> &lt;script&gt;alert(1)&lt;/script&gt;</li>\n</ol>\n<!-- /wp:footnotes -->');
});
test("unsafe links remain text and code content stays literal", () => {
  const source = 'Text[^a].\n\n[^a]: [bad](javascript:alert) [bad](https://example.org/"x) `*literal* <tag>`';
  const block = buildWordPressFootnotes(source);
  assert.ok(!block.includes('<a href='));
  assert.ok(block.includes('<code>*literal* &lt;tag&gt;</code>'));
});
test("repeated references are left unchanged with a warning", () => {
  const source = 'Twice[^a] and again[^a].\n\n[^a]: Note';
  assert.equal(renumberFootnotes(source).source, source);
  assert.ok(notices.some(message => message.includes('Repeated footnote')));
});
test("empty notes yield no block", () => assert.equal(buildWordPressFootnotes("Nothing here."), ""));
process.exitCode = failed ? 1 : 0;
