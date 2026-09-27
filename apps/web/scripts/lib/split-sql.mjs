/**
 * Statement splitter shared by the migration tooling (extracted so importing it
 * does not execute the gate itself).

 * Does not break dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$) or string
 * literals. A naive split on ';' corrupts the DO-block in migration 005 and any
 * future function body — which is how a migration can "apply" while silently
 * destroying its own logic.
 */
export function splitStatements(ddl) {
  const out = [];
  let buf = '';
  let dollarTag = null;
  let inLineComment = false;
  let inString = false;

  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    const rest = ddl.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (inString) {
      buf += ch;
      if (ch === "'" && ddl[i + 1] === "'") {
        buf += "'";
        i++;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === '-' && ddl[i + 1] === '-') {
      inLineComment = true;
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inString = true;
      buf += ch;
      continue;
    }
    if (ch === '$') {
      const m = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
