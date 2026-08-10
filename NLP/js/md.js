/* md.js — 极简 Markdown 渲染器（无外部依赖），支持讲义常用语法 */
(function () {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  function render(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre class="md-pre"><code>' + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      // 表格
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
        const header = line.split("|").slice(1, -1).map((c) => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
          i++;
        }
        out.push(
          '<table class="md-table"><thead><tr>' +
            header.map((h) => "<th>" + inline(h) + "</th>").join("") +
            "</tr></thead><tbody>" +
            rows.map((r) => "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") +
            "</tbody></table>"
        );
        continue;
      }
      // 标题
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = h[1].length + 1; // h1→h2，页面内从 h2 起
        out.push("<h" + lv + ' class="md-h">' + inline(h[2]) + "</h" + lv + ">");
        i++;
        continue;
      }
      // 引用
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push('<blockquote class="md-quote">' + buf.map(inline).join("<br>") + "</blockquote>");
        continue;
      }
      // 无序列表
      if (/^\s*[-*]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          buf.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push('<ul class="md-ul">' + buf.join("") + "</ul>");
        continue;
      }
      // 有序列表
      if (/^\s*\d+[.、]\s*/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+[.、]\s*/.test(lines[i])) {
          buf.push("<li>" + inline(lines[i].replace(/^\s*\d+[.、]\s*/, "")) + "</li>");
          i++;
        }
        out.push('<ol class="md-ol">' + buf.join("") + "</ol>");
        continue;
      }
      // 分割线
      if (/^\s*---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      // 空行
      if (/^\s*$/.test(line)) { i++; continue; }
      // 普通段落（合并连续行）
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,4}\s|```|>\s?|\s*[-*]\s|\s*\d+[.、]\s|\s*\|)/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push('<p class="md-p">' + buf.map(inline).join("<br>") + "</p>");
    }
    return out.join("\n");
  }

  window.MD = { render };
})();
