import ts from "typescript";
import fs from "fs";
import path from "path";

const root = "/workspace/open-sse";

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function annotateCatch(fileName, sourceText) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const edits = [];

  const visit = (node) => {
    if (ts.isCatchClause(node) && node.variableDeclaration && !node.variableDeclaration.type) {
      edits.push({ pos: node.variableDeclaration.name.end, text: ": any" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) return null;
  edits.sort((a, b) => b.pos - a.pos);
  let out = sourceText;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return out;
}

let n = 0;
for (const f of walk(root)) {
  const src = fs.readFileSync(f, "utf8");
  const next = annotateCatch(f, src);
  if (next && next !== src) {
    fs.writeFileSync(f, next);
    n++;
  }
}
console.log(`catch-annotated ${n} files`);
