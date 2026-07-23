/**
 * markdown.js — small dependency-free Markdown-to-HTML formatter for the
 * Docs modal (client/js/docs.js). Covers only what the six root-level docs
 * it renders actually use: headings, fenced code blocks, inline code,
 * bold/italic, links, unordered/ordered lists, horizontal rules, and
 * paragraphs. Not a general-purpose parser — no nested lists, blockquotes,
 * or tables.
 */

import { esc } from './utils.js';

function formatInline(text) {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
    const safeUrl = /^(https?:)?\/\//.test(url) || url.startsWith('/') || url.startsWith('#') ? url : '#';
    return `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

export function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let paragraph = [];
  let list = null; // { tag: 'ul'|'ol', items: [] }

  function flushParagraph() {
    if (paragraph.length) {
      html.push(`<p>${formatInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  }
  function flushList() {
    if (list) {
      html.push(`<${list.tag}>${list.items.map(item => `<li>${formatInline(item)}</li>`).join('')}</${list.tag}>`);
      list = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      html.push('<hr>');
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const tag = unordered ? 'ul' : 'ol';
      const itemText = (unordered || ordered)[1];
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(itemText);
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  flushList();

  return html.join('\n');
}
