/**
 * A small markdown reader for assistant answers: headings, paragraphs, bullet and numbered
 * lists, simple pipe tables, rules, bold, italic, inline code, and order IDs as links.
 * It returns plain data; the chat renders it with React, so no HTML is ever injected.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "order"; text: string; href: string };

export type Block =
  | { type: "heading"; level: number; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "rule" }
  | { type: "pre"; text: string };

const ORDER_RE = /\b(EPK-\d{4,})\b|(#PIK\d{3,})\b/;

function orderLinks(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  for (let guard = 0; rest && guard < 200; guard += 1) {
    const match = ORDER_RE.exec(rest);
    if (!match) break;
    if (match.index > 0) out.push({ type: "text", text: rest.slice(0, match.index) });
    const id = match[0];
    out.push({ type: "order", text: id, href: id.startsWith("EPK-") ? `/orders/${id}` : `/orders?q=${encodeURIComponent(id)}` });
    rest = rest.slice(match.index + id.length);
  }
  if (rest) out.push({ type: "text", text: rest });
  return out;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(...orderLinks(buffer));
    buffer = "";
  };
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith("`")) {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const marker = rest.slice(0, 2);
      const end = text.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "bold", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((rest.startsWith("*") || rest.startsWith("_")) && /\S/.test(rest[1] ?? "") && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const marker = rest[0];
      const end = text.indexOf(marker, i + 1);
      if (end > i + 1 && /\S/.test(text[end - 1]) && !/\w/.test(text[end + 1] ?? "")) {
        flush();
        out.push({ type: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i += 1;
      blocks.push({ type: "pre", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, content: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const listMatch = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (listMatch) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = pattern.exec(lines[i]);
        if (m) {
          items.push(parseInline(m[1]));
          i += 1;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].push({ type: "text", text: " " }, ...parseInline(lines[i].trim()));
          i += 1;
        } else break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !lines[i].trim().startsWith("```") && !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", content: parseInline(para.join(" ")) });
  }
  return blocks;
}
