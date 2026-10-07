import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderMarkdown} from './markdown.mjs';
import {renderTaskDocument} from './documents.mjs';
const md=String.raw`# A clear question

## Background

**Earlier runs** may help. [Read the paper](https://example.org/paper).

- Observe earlier runs.
- Test a new rule.

1. Build it.
2. Compare errors.

> This is a planned test.

| Method | Errors |
| --- | --- |
| Baseline | Unknown |

Inline \(p_i=\frac{1}{2}\) and $x^2$.

\[
y = \sum_i p_i
\]

$$
z = x + y
$$

---
`+'\n```text\n<script>alert(1)</script> $raw$\n```';
const html=renderMarkdown(md);
for(const expected of ['<h1>A clear question</h1>','<h2>Background</h2>','<strong>Earlier runs</strong>','<ul>','<ol>','<table>','<blockquote>','<hr>','data-display="true"','data-display="false"','href="https://example.org/paper"','&lt;script&gt;alert(1)&lt;/script&gt; $raw$'])assert(html.includes(expected),expected);
assert(!html.includes('<script>'));assert(!renderMarkdown('[bad](javascript:alert) <img onerror=alert(1)>').includes('href='));
const browser={};vm.runInNewContext(fs.readFileSync(new URL('./frontend/vendor/katex/katex.min.js',import.meta.url),'utf8'),browser);vm.runInNewContext(fs.readFileSync(new URL('./markdown.mjs',import.meta.url),'utf8').replace(/^export /gm,'')+'\nglobalThis.render=renderMarkdown;',browser);
const rich=browser.render(md);assert(rich.includes('class="katex"'));assert(!rich.includes('math-source'));assert(rich.includes('$raw$'));
assert(!browser.render(String.raw`$\href{javascript:alert(1)}{unsafe}$`).includes('href="javascript:'));
const task={id:'markdown-check',summary:'Preview',result:{document:md},finished_at:'2026-10-06'};
const page=renderTaskDocument(task,'Researcher','fixture');assert(page.includes('/math.js'));assert(page.includes('<main class="markdown-body">'));assert(page.includes('format=markdown'));assert.equal(task.result.document,md);
console.log('Passed formatted headings, lists, tables, quotes, links, code, inline/display equations, safe markup and unchanged Markdown export.');
