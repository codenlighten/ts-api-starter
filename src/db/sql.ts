/**
 * Splits a migration into its top-level statements, with comments removed and the contents of strings,
 * quoted names and dollar-quoted bodies blanked, so that what is left can be inspected safely.
 * It is not an SQL parser: it only knows where the text that is not code begins and ends.
 */
export function outline(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const skipPast = (end: string, from: number) => {
    const at = sql.indexOf(end, from);
    return at === -1 ? sql.length : at + end.length;
  };
  while (i < sql.length) {
    const rest = sql.slice(i, i + 2);
    const dollar = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 80))?.[0];
    if (rest === "--") {
      i = skipPast("\n", i);
      current += " ";
    } else if (rest === "/*") {
      // PostgreSQL block comments nest.
      let depth = 1;
      for (i += 2; i < sql.length && depth > 0; i++) {
        if (sql.startsWith("/*", i)) [depth, i] = [depth + 1, i + 1];
        else if (sql.startsWith("*/", i)) [depth, i] = [depth - 1, i + 1];
      }
      current += " ";
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i] as string;
      // Only E'...' strings treat a backslash as an escape; a doubled quote stands for itself in both kinds.
      const escapes = quote === "'" && /(^|[^\w$])[eE]$/.test(current);
      for (i += 1; i < sql.length; i++) {
        if (escapes && sql[i] === "\\") i++;
        else if (sql[i] === quote && sql[i + 1] === quote) i++;
        else if (sql[i] === quote) break;
      }
      i++;
      current += quote + quote;
    } else if (dollar && !/[\w$]$/.test(current)) {
      i = skipPast(dollar, i + dollar.length);
      current += "''";
    } else if (sql[i] === ";") {
      statements.push(current);
      current = "";
      i++;
    } else {
      current += sql[i];
      i++;
    }
  }
  statements.push(current);
  return statements.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

const TRANSACTION_CONTROL = /^(begin|commit|end|abort|rollback(?!( work| transaction)? to\b)|start transaction|prepare transaction)\b/i;

/** The first statement that would start or end a transaction, if there is one. */
export function transactionControl(sql: string): string | undefined {
  return outline(sql).find((s) => TRANSACTION_CONTROL.test(s));
}
