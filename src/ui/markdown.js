// @ts-check
// Just enough Markdown for the robot's reports. Everything is escaped first, so model text can't inject HTML.

(function () {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

  function inline(s) {
    const codes = [];
    return esc(s)
      .replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  }

  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

  /** @param {string} src */
  function render(src) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    let html = "";
    let para = [];
    /** @type {null | {tag: string, items: string[]}} */
    let list = null;

    const flushPara = () => {
      if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
      para = [];
    };
    const flushList = () => {
      if (list) html += `<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`;
      list = null;
    };
    const flush = () => {
      flushPara();
      flushList();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        flush();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
        continue;
      }

      // table: a header row followed by |---|---|
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
        flush();
        const head = cells(line);
        i++;
        const rows = [];
        while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
        html += `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) {
        flush();
        const tag = heading[1].length <= 2 ? "h3" : "h4";
        html += `<${tag}>${inline(heading[2])}</${tag}>`;
        continue;
      }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flush();
        html += "<hr>";
        continue;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flush();
        html += `<blockquote>${inline(quote[1])}</blockquote>`;
        continue;
      }

      const bullet = line.match(/^\s*(?:[-*•+])\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        flushPara();
        const tag = bullet ? "ul" : "ol";
        if (list?.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push((bullet ?? numbered)[1]);
        continue;
      }

      if (!line.trim()) {
        flush();
        continue;
      }

      // a wrapped continuation of the last list item
      if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += " " + line.trim();
        continue;
      }

      flushList();
      para.push(line);
    }
    flush();
    return html;
  }

  /** @type {any} */ (window).markdown = { render };
})();
