const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'WITH', 'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'DESC', 'ASC', 'OVER', 'PARTITION',
]);
const FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_IF', 'DATE_TRUNC', 'COALESCE', 'ROUND']);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tiny tokenizer → HTML with span classes. Output is escaped, so it is safe for [innerHTML]. */
export function highlightSql(sql: string): string {
  return sql.replace(/('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][\w]*\b)|([^\w']+)/g, (m, str, num, word, other) => {
    if (str) return `<span class="t-str">${esc(str)}</span>`;
    if (num) return `<span class="t-num">${num}</span>`;
    if (word) {
      const up = word.toUpperCase();
      if (KEYWORDS.has(up)) return `<span class="t-kw">${esc(word)}</span>`;
      if (FUNCTIONS.has(up)) return `<span class="t-fn">${esc(word)}</span>`;
      return esc(word);
    }
    return esc(other ?? m);
  });
}
