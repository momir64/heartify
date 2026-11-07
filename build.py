"""Package Heartify for Chrome and Firefox into dist/.

Usage: python build.py
Each zip contains the browser's manifest renamed to manifest.json plus the shared sources.
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
FILES = ["background.js", "content.js", "inject.js"]
DIRS = ["assets", "icons"]
TARGETS = {"chrome": "manifest.chrome.json", "firefox": "manifest.firefox.json"}


def build(name, manifest_file):
    manifest = json.loads((ROOT / manifest_file).read_text(encoding="utf-8"))
    out = DIST / f"heartify-{name}-{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=4))
        for f in FILES:
            z.write(ROOT / f, f)
        for d in DIRS:
            for p in sorted((ROOT / d).rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(ROOT).as_posix())
    print(f"built {out.relative_to(ROOT)}")


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    for old in DIST.glob("heartify-*.zip"):
        old.unlink()
    for name, manifest_file in TARGETS.items():
        build(name, manifest_file)
