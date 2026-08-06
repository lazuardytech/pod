import re
from pathlib import Path

root = Path("/workspace/tests")
changed = []
for path in root.rglob("*.ts"):
    text = path.read_text()
    orig = text
    lines = []
    for line in text.splitlines(True):
        if "open-sse/" in line and (
            "readFileSync" in line
            or "existsSync" in line
            or "resolve(" in line
            or ("join(" in line and "open-sse/" in line)
        ):
            line = re.sub(r"(open-sse/[^\"']+)\.js", r"\1.ts", line)
        lines.append(line)
    text = "".join(lines)
    if text != orig:
        path.write_text(text)
        changed.append(str(path))

print(f"patched {len(changed)} files")
for c in changed:
    print(" ", c)
