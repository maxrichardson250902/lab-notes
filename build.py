#!/usr/bin/env python3
"""
Build script: combines static/index.dev.html + static/core.js + static/features/*.js
into static/index.html with all JS inlined.

Run: python build.py
"""
import re
from pathlib import Path

STATIC = Path(__file__).parent / "static"
DEV_HTML = STATIC / "index.dev.html"
OUT_HTML = STATIC / "index.html"

# Order matters — core first, then features in the order the dev HTML lists them
FEATURE_ORDER = [
    "notebook", "workflow",  "protocols", "summaries","pipeline" ,"addform",
     "scratch", "reminders", "gel_annotation", "timeline",
    "predictions","circuits","cloning","sanger", "dilution","import_data","backup","tm_calc",  "import", "enrichment",
]


def build():
    html = DEV_HTML.read_text()

    # Inline CSS — replace the stylesheet link with a <style> block
    css_path = STATIC / "style.css"
    if css_path.exists():
        css = css_path.read_text()
        html = html.replace(
            '<link rel="stylesheet" href="/static/style.css">',
            f'<style>\n{css}\n</style>'
        )

    # Collect all JS
    js_parts = []
    js_parts.append(f"// ── core.js ──\n{(STATIC / 'core.js').read_text()}")
    for name in FEATURE_ORDER:
        path = STATIC / "features" / f"{name}.js"
        if path.exists():
            js_parts.append(f"// ── {name}.js ──\n{path.read_text()}")
        else:
            print(f"  WARN: {path} not found, skipping")

    all_js = "\n\n".join(js_parts)

    # Replace the script tags block with a single inline <script>
    start_marker = "<!-- SCRIPTS_START -->"
    end_marker = "<!-- SCRIPTS_END -->"
    start_idx = html.index(start_marker)
    end_idx = html.index(end_marker) + len(end_marker)
    html = html[:start_idx] + f'<script>\n{all_js}\n\nboot();\n</script>' + html[end_idx:]

    OUT_HTML.write_text(html)
    lines = html.count("\n") + 1
    print(f"Built {OUT_HTML} ({lines} lines)")


if __name__ == "__main__":
    build()
