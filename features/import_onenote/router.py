"""OneNote import feature — parse .mht/.html/.zip exports and bulk import."""
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import List
from datetime import datetime
from html.parser import HTMLParser
import re, json, uuid as _uuid

from core.database import get_db

# ── Staging store for parsed batches (images held server-side) ────────────────
_import_staging: dict = {}

# ── OneNote HTML parser ───────────────────────────────────────────────────────

class OneNoteHTMLParser(HTMLParser):
    """Extract title, date, and formatted text from OneNote HTML export."""
    def __init__(self):
        super().__init__()
        self._in_title = False
        self._in_body = False
        self.title = ""
        self.chunks = []
        self._skip_tags = {"script", "style", "head"}
        self._skip_depth = 0
        self._list_depth = 0
        self._tag_stack = []
        self._table_stack = []
        self._td_buf = []

    def _ensure_newline(self):
        if self.chunks and not self.chunks[-1].endswith('\n'):
            self.chunks.append('\n')

    def _get_attr(self, attrs, name):
        for k, v in attrs:
            if k == name: return v
        return None

    def _in_data_cell(self):
        for t in reversed(self._table_stack):
            if t.get('in_cell'):
                return t['border']
        return False

    def handle_starttag(self, tag, attrs):
        if tag in self._skip_tags:
            self._skip_depth += 1; return
        if self._skip_depth > 0: return
        if tag == "title": self._in_title = True
        if tag == "body": self._in_body = True
        if not self._in_body: return

        if tag in ("h1", "h2", "h3", "h4"):
            self._ensure_newline()
            self.chunks.append("## " if tag in ("h1", "h2") else "### ")
        elif tag == "p":
            style = self._get_attr(attrs, 'style') or ''
            if 'font-size:1pt' in style.replace(' ', ''): return
            if not self._in_data_cell():
                self._ensure_newline()
        elif tag == "div":
            if not self._in_data_cell():
                self._ensure_newline()
        elif tag == "br":
            self.chunks.append("\n")
        elif tag in ("ul", "ol"):
            self._list_depth += 1; self._ensure_newline()
        elif tag == "li":
            self.chunks.append(f"\n{'  ' * max(0, self._list_depth - 1)}\u2022 ")
        elif tag == "table":
            border = self._get_attr(attrs, 'border')
            style = self._get_attr(attrs, 'style') or ''
            is_data = (border == '1' or 'border-style:solid' in style.replace(' ', ''))
            self._table_stack.append({'border': is_data, 'rows': [], 'row': [], 'in_cell': False})
            if is_data: self._ensure_newline()
        elif tag == "tr":
            if self._table_stack:
                self._table_stack[-1]['row'] = []
        elif tag in ("td", "th"):
            if self._table_stack:
                self._table_stack[-1]['in_cell'] = True
                self._td_buf = []
        elif tag in ("b", "strong"):
            self.chunks.append("**")
        elif tag in ("i", "em"):
            self.chunks.append("_")
        elif tag == "hr":
            self.chunks.append("\n---\n")
        elif tag == "sup":
            self.chunks.append("^")

    def handle_endtag(self, tag):
        if tag in self._skip_tags and self._skip_depth > 0:
            self._skip_depth -= 1; return
        if self._skip_depth > 0: return
        if tag == "title": self._in_title = False
        if not self._in_body: return

        if tag in ("h1", "h2", "h3", "h4"):
            self.chunks.append("\n")
        elif tag in ("ul", "ol"):
            self._list_depth = max(0, self._list_depth - 1)
            self.chunks.append("\n")
        elif tag in ("td", "th"):
            if self._table_stack and self._table_stack[-1]['in_cell']:
                cell = re.sub(r'\s+', ' ', "".join(self._td_buf)).strip()
                if self._table_stack[-1]['border']:
                    self._table_stack[-1]['row'].append(cell)
                self._table_stack[-1]['in_cell'] = False
                self._td_buf = []
        elif tag == "tr":
            if self._table_stack:
                t = self._table_stack[-1]
                if t['border']:
                    row = [c for c in t['row'] if c and c != '\xa0']
                    if row: t['rows'].append(row)
                t['row'] = []
        elif tag == "table":
            if self._table_stack:
                tbl = self._table_stack.pop()
                if tbl['border'] and tbl['rows']:
                    rows = tbl['rows']
                    max_cols = max(len(r) for r in rows)
                    for r in rows:
                        while len(r) < max_cols: r.append('')
                    widths = [max(len(r[ci]) for r in rows) for ci in range(max_cols)]
                    self._ensure_newline()
                    for ri, row in enumerate(rows):
                        line = ' | '.join(cell.ljust(widths[ci]) for ci, cell in enumerate(row))
                        self.chunks.append(line.rstrip() + '\n')
                        if ri == 0 and len(rows) > 1:
                            self.chunks.append('-|-'.join('-' * w for w in widths) + '\n')
                    self.chunks.append('\n')
        elif tag in ("b", "strong"):
            self.chunks.append("**")
        elif tag in ("i", "em"):
            self.chunks.append("_")

    def handle_data(self, data):
        if self._skip_depth > 0: return
        if self._in_title: self.title += data
        if not self._in_body: return
        stripped = data.strip()
        if not stripped or stripped == '\xa0': return
        if self._in_data_cell():
            self._td_buf.append(data)
        else:
            self.chunks.append(data)


def parse_onenote_html(html_content: str, filename: str = "") -> dict:
    parser = OneNoteHTMLParser()
    parser.feed(html_content)
    title = parser.title.strip() or filename.replace(".html", "").replace(".htm", "")
    text = "".join(parser.chunks)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = text.replace('\xa0', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r' *\n *', '\n', text)
    text = re.sub(r'^\s+$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()

    date = None
    date_patterns = [
        (r'(\d{4}-\d{2}-\d{2})', '%Y-%m-%d'),
        (r'(\d{1,2}/\d{1,2}/\d{4})', None),
        (r'(\d{1,2}-\d{1,2}-\d{4})', None),
    ]
    for pattern, fmt in date_patterns:
        m = re.search(pattern, title + " " + text[:200])
        if m:
            try:
                if fmt:
                    date = datetime.strptime(m.group(1), fmt).strftime('%Y-%m-%d')
                else:
                    parts = re.split(r'[/-]', m.group(1))
                    if len(parts) == 3:
                        d, mo, y = int(parts[0]), int(parts[1]), int(parts[2])
                        if d > 12:    date = f"{y}-{mo:02d}-{d:02d}"
                        elif mo > 12: date = f"{y}-{d:02d}-{mo:02d}"
                        else:         date = f"{y}-{mo:02d}-{d:02d}"
            except: pass
            if date: break

    if not date:
        month_pat = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}'
        m = re.search(month_pat, title + " " + text[:300], re.IGNORECASE)
        if m:
            try:
                cleaned = m.group().replace(",", "")
                date = datetime.strptime(cleaned, '%B %d %Y').strftime('%Y-%m-%d')
            except: pass

    text_lower = text.lower()
    title_lower = title.lower()
    content_type = "entry"
    protocol_signals = ["protocol", "method", "procedure", "step 1", "step 2",
                        "reagent", "buffer", "incubat", "centrifug", "wash with",
                        "add \u00b5l", "add ul", "add ml", "minutes at", "rpm"]
    protocol_score = sum(1 for s in protocol_signals if s in text_lower or s in title_lower)
    if protocol_score >= 3 or "protocol" in title_lower or "method" in title_lower:
        content_type = "protocol"

    return {
        "title": title[:200],
        "date": date or datetime.utcnow().strftime('%Y-%m-%d'),
        "content_type": content_type,
        "group_name": "",
        "subgroup": "",
        "notes": text[:8000],
        "results": "",
        "issues": "",
        "steps": text[:8000] if content_type == "protocol" else "",
        "preview": text[:400],
        "char_count": len(text),
        "filename": filename,
    }


def parse_mht(content: bytes, filename: str = "") -> list[dict]:
    import email, base64
    from email import policy
    results = []
    try:
        msg = email.message_from_bytes(content, policy=policy.default)
    except:
        try:
            html = content.decode("utf-8", errors="replace")
            return split_onenote_pages(html, filename)
        except:
            return [{"title": filename, "error": "Could not parse MHT", "content_type": "skip"}]

    html_parts = []
    images = {}

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            payload = part.get_payload(decode=True)
            if not payload: continue
            if ct in ("text/html", "application/xhtml+xml"):
                charset = part.get_content_charset() or "utf-8"
                try: html_parts.append(payload.decode(charset, errors="replace"))
                except: html_parts.append(payload.decode("latin-1", errors="replace"))
            elif ct.startswith("image/"):
                import base64 as b64
                loc = part.get("Content-Location", "")
                fname = loc.replace("\\", "/").split("/")[-1] if loc else ""
                if fname:
                    images[fname.lower()] = {
                        "data": b64.b64encode(payload).decode(),
                        "media_type": ct,
                        "filename": fname,
                    }
    else:
        ct = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try: html_text = payload.decode(charset, errors="replace")
            except: html_text = payload.decode("latin-1", errors="replace")
            if ct in ("text/html", "application/xhtml+xml"):
                html_parts.append(html_text)
            else:
                return [{"title": filename.replace(".mht", ""),
                         "date": datetime.utcnow().strftime('%Y-%m-%d'),
                         "content_type": "entry", "group_name": "", "subgroup": "",
                         "notes": html_text[:8000], "results": "", "issues": "",
                         "steps": "", "preview": html_text[:400],
                         "char_count": len(html_text), "filename": filename}]

    if not html_parts:
        return [{"title": filename, "error": "No HTML content found in MHT", "content_type": "skip"}]

    for html in html_parts:
        pages = split_onenote_pages(html, filename, images)
        results.extend(pages)

    return results if results else [{"title": filename, "error": "Empty MHT", "content_type": "skip"}]


def split_onenote_pages(html: str, filename: str = "", images: dict = None) -> list[dict]:
    title_hits = list(re.finditer(
        r'font-size:\s*(?:1[6-9]|[2-9]\d)\.0pt[^>]*>(.+?)</p>',
        html, re.DOTALL | re.IGNORECASE
    ))

    if len(title_hits) < 2:
        chunks = re.split(
            r'(?:<br\s+clear\s*=\s*["\']?all["\']?\s*/?\s*>|<(?:div|p)[^>]*page-break-before\s*:\s*always[^>]*>)',
            html, flags=re.IGNORECASE
        )
        if len(chunks) > 1:
            results = []
            for ci, chunk in enumerate(chunks):
                chunk = chunk.strip()
                if len(chunk) < 30: continue
                if "<html" not in chunk.lower() and "<body" not in chunk.lower():
                    chunk = f"<html><body>{chunk}</body></html>"
                item = parse_onenote_html(chunk, f"{filename} \u2014 page {ci + 1}")
                results.append(item)
            return results if results else [parse_onenote_html(html, filename)]
        return [parse_onenote_html(html, filename.replace(".mht", "").replace(".mhtml", ""))]

    pages = []
    months = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12'
    }

    for i, hit in enumerate(title_hits):
        raw_title = re.sub(r'<[^>]+>', '', hit.group(1))
        raw_title = re.sub(r'&nbsp;', ' ', raw_title)
        raw_title = re.sub(r'\s+', ' ', raw_title).strip()

        chunk_start = max(0, hit.start() - 300)
        div_search = html[chunk_start:hit.start()]
        last_div = div_search.rfind('<div')
        if last_div >= 0:
            chunk_start = chunk_start + last_div

        if i + 1 < len(title_hits):
            next_start = title_hits[i + 1].start()
            pre_next = html[max(0, next_start - 300):next_start]
            last_div_next = pre_next.rfind('<div')
            if last_div_next >= 0:
                chunk_end = max(0, next_start - 300) + last_div_next
            else:
                chunk_end = next_start
        else:
            chunk_end = len(html)

        chunk_html = html[chunk_start:chunk_end]

        date = None
        after_title = html[hit.end():hit.end() + 500]
        date_match = re.search(
            r'color:\s*#767676[^>]*>\s*(\d{1,2})\s+(\w+)\s+(\d{4})',
            after_title, re.DOTALL | re.IGNORECASE
        )
        if date_match:
            day = int(date_match.group(1))
            month_name = date_match.group(2).lower()
            year = int(date_match.group(3))
            month_num = months.get(month_name)
            if month_num:
                date = f"{year}-{month_num}-{day:02d}"

        if not date and raw_title:
            dm = re.search(r'(\d{1,2})[./](\d{1,2})[./](\d{2,4})', raw_title)
            if dm:
                d, m, y = int(dm.group(1)), int(dm.group(2)), int(dm.group(3))
                if y < 100: y += 2000
                if d > 12:    date = f"{y}-{m:02d}-{d:02d}"
                elif m > 12:  date = f"{y}-{d:02d}-{m:02d}"
                else:         date = f"{y}-{m:02d}-{d:02d}"

        last_open = chunk_html.rfind('<')
        last_close = chunk_html.rfind('>')
        if last_open > last_close:
            chunk_html = chunk_html[:last_open]

        open_tds = chunk_html.lower().count('<td') - chunk_html.lower().count('</td')
        if open_tds > 0: chunk_html += '</td>' * open_tds
        open_trs = chunk_html.lower().count('<tr') - chunk_html.lower().count('</tr')
        if open_trs > 0: chunk_html += '</tr>' * open_trs
        open_tables = chunk_html.lower().count('<table') - chunk_html.lower().count('</table')
        if open_tables > 0: chunk_html += '</table>' * open_tables

        if "<html" not in chunk_html.lower() and "<body" not in chunk_html.lower():
            chunk_html = f"<html><body>{chunk_html}</body></html>"

        item = parse_onenote_html(chunk_html, "")
        if raw_title and raw_title != '&nbsp;':
            item["title"] = raw_title[:200]
        elif not item["title"]:
            item["title"] = f"{filename} \u2014 page {i + 1}"
        if date:
            item["date"] = date
        if item.get("char_count", 0) < 5 and not item.get("notes"):
            continue

        if images:
            page_images = []
            for m in re.finditer(r'src=["\']([^"\']+)["\']', chunk_html, re.IGNORECASE):
                src = m.group(1).replace("\\", "/").split("/")[-1].lower()
                if src in images:
                    page_images.append(images[src])
            item["images"] = page_images
        else:
            item["images"] = []

        pages.append(item)

    return pages if pages else [parse_onenote_html(html, filename.replace(".mht", "").replace(".mhtml", ""))]


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["import"])

@router.post("/import/parse")
async def import_parse(files: List[UploadFile] = File(...)):
    import zipfile, io
    parsed = []
    for f in files:
        try:
            content = await f.read()
            fname = (f.filename or "").lower()
            if fname.endswith((".mht", ".mhtml")):
                pages = parse_mht(content, f.filename or "")
                for item in pages:
                    item["file_index"] = len(parsed)
                    item["source"] = f.filename or ""
                    parsed.append(item)
                continue
            if fname.endswith(".zip"):
                try:
                    zf = zipfile.ZipFile(io.BytesIO(content))
                    file_names = [n for n in zf.namelist()
                                  if n.lower().endswith((".html", ".htm", ".mht", ".mhtml"))
                                  and not n.startswith("__MACOSX")]
                    file_names.sort()
                    for zname in file_names:
                        try:
                            zdata = zf.read(zname)
                            parts = zname.replace("\\", "/").split("/")
                            section_name = ""
                            page_name = re.sub(r'\.(html?|mhtml?)$', '', parts[-1], flags=re.IGNORECASE)
                            if len(parts) >= 3: section_name = parts[-2]
                            elif len(parts) == 2: section_name = parts[0]
                            if zname.lower().endswith((".mht", ".mhtml")):
                                pages = parse_mht(zdata, page_name)
                                for item in pages:
                                    if section_name and not item.get("group_name"):
                                        item["group_name"] = section_name
                                    item["file_index"] = len(parsed)
                                    item["source"] = zname
                                    parsed.append(item)
                            else:
                                try: html = zdata.decode("utf-8")
                                except: html = zdata.decode("latin-1")
                                item = parse_onenote_html(html, page_name)
                                if section_name and not item["group_name"]:
                                    item["group_name"] = section_name
                                item["file_index"] = len(parsed)
                                item["source"] = zname
                                parsed.append(item)
                        except Exception as e:
                            parsed.append({"title": zname, "error": str(e),
                                           "file_index": len(parsed), "content_type": "skip", "source": zname})
                    continue
                except Exception:
                    pass
            try: html = content.decode("utf-8")
            except: html = content.decode("latin-1")
            item = parse_onenote_html(html, f.filename or "")
            item["file_index"] = len(parsed)
            parsed.append(item)
        except Exception as e:
            parsed.append({"title": f.filename or "Unknown", "error": str(e),
                           "file_index": len(parsed), "content_type": "skip"})

    batch_id = str(_uuid.uuid4())[:8]
    _import_staging[batch_id] = parsed

    client_pages = []
    for p in parsed:
        cp = {k: v for k, v in p.items() if k != "images"}
        cp["image_count"] = len(p.get("images", []))
        client_pages.append(cp)
    return {"pages": client_pages, "total": len(parsed), "batch_id": batch_id}


class ImportItem(BaseModel):
    title:        str
    content_type: str = "entry"
    group_name:   str = ""
    subgroup:     str = ""
    date:         str = ""
    notes:        str = ""
    results:      str = ""
    issues:       str = ""
    steps:        str = ""

class ImportBatch(BaseModel):
    items: List[ImportItem]
    batch_id: str = ""

@router.post("/import/commit")
async def import_commit(batch: ImportBatch):
    now = datetime.utcnow().isoformat()
    created_entries = 0
    created_protocols = 0
    created_images = 0
    skipped = 0
    staged = _import_staging.pop(batch.batch_id, None)

    for idx, item in enumerate(batch.items):
        if item.content_type == "skip":
            skipped += 1
            continue
        if item.content_type == "protocol":
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO protocols (title,url,source_text,steps,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?)",
                    (item.title, None, item.notes, item.steps or item.notes,
                     "", "[]", now, now))
                conn.commit()
            created_protocols += 1
        else:
            date = item.date or datetime.utcnow().strftime('%Y-%m-%d')
            with get_db() as conn:
                cur = conn.execute(
                    "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (item.title, item.group_name, item.subgroup or "Notes",
                     date, item.notes, item.results, "", item.issues, now, now))
                entry_id = cur.lastrowid
                if staged and idx < len(staged):
                    page_images = staged[idx].get("images", [])
                    for img in page_images:
                        conn.execute(
                            "INSERT INTO entry_images (entry_id,filename,image_data,media_type,created) VALUES (?,?,?,?,?)",
                            (entry_id, img["filename"], img["data"], img["media_type"], now))
                        created_images += 1
                conn.commit()
            created_entries += 1

    return {
        "created_entries": created_entries,
        "created_protocols": created_protocols,
        "created_images": created_images,
        "skipped": skipped,
        "total": len(batch.items),
    }
