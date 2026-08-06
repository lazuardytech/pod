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

function annotateSource(fileName, sourceText) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const edits = [];

  const visitParams = (params) => {
    for (const p of params) {
      if (p.type) continue;
      edits.push({ pos: p.name.end, text: ": any" });
    }
  };

  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      if (node.parameters) visitParams(node.parameters);
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
  const next = annotateSource(f, src);
  if (next && next !== src) {
    fs.writeFileSync(f, next);
    n++;
  }
}
console.log(`AST-annotated ${n} files`);
