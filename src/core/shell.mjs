// canivete core/shell — escapes puros contra injeção (zero deps).
// Shell: envolve em aspas simples; `'` interno vira `'"'"'`.
// SQL (SQLite): dobra `'` p/ não quebrar o literal nem injetar.
export function escapeShellArg(s) {
  return `'${String(s ?? "").replace(/'/g, `'"'"'`)}'`;
}
export function escapeSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}
