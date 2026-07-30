"""Parse a formatted project-plan markdown document into a pipeline graph
(steps + dependency edges + auto-layout positions).

This is deterministic — no LLM. It relies on the structure produced by the
planning prompt: H2 headings numbered `## N. Title`, with bullet fields
`Day:`, `Depends on:`, `Category:`, `Materials:`, `Protocols:`, `Detail:`.

If a plan does not follow the format, parsing degrades gracefully: any H2 is
treated as a step, missing dependencies yield a linear chain fallback only when
NO dependencies are found at all (so an unstructured plan still produces a
readable left-to-right sequence rather than a pile of disconnected nodes).
"""
import re

_STEP_HEADING = re.compile(r'^##\s+(\d+)[.)]\s+(.*\S)\s*$')
_FIELD = re.compile(r'^\s*[-*]\s*\*?\*?([A-Za-z ]+?)\*?\*?\s*:\s*(.*\S)\s*$')


def _parse_depends(raw):
    """'2, 3' or 'steps 2 and 3' or 'none' -> [2, 3] (1-based step numbers)."""
    if not raw:
        return []
    low = raw.strip().lower()
    if low in ('none', 'n/a', '-', ''):
        return []
    return [int(n) for n in re.findall(r'\d+', raw)]


def parse_plan(md):
    """Return {'steps': [...], 'edges': [(from_no, to_no), ...]}.

    Each step: {no, title, day, depends, category, materials, protocols, detail}.
    Step numbers are the author's `## N.` numbers (1-based, as written).
    Edges are (dependency_no -> step_no) pairs."""
    lines = (md or '').replace('\r\n', '\n').split('\n')
    steps = []
    current = None
    for line in lines:
        h = _STEP_HEADING.match(line)
        if h:
            if current:
                steps.append(current)
            current = {
                'no': int(h.group(1)), 'title': h.group(2).strip(),
                'day': '', 'depends': [], 'category': '',
                'materials': '', 'protocols': '', 'detail': '',
            }
            continue
        if current is None:
            continue
        f = _FIELD.match(line)
        if f:
            key = f.group(1).strip().lower()
            val = f.group(2).strip().strip('*').strip()
            if key == 'day':
                current['day'] = val
            elif key in ('depends on', 'depends', 'dependencies'):
                current['depends'] = _parse_depends(val)
            elif key == 'category':
                current['category'] = val
            elif key == 'materials':
                current['materials'] = val
            elif key in ('protocols', 'protocol'):
                current['protocols'] = val
            elif key in ('detail', 'details', 'description'):
                current['detail'] = val
    if current:
        steps.append(current)

    # Edges from declared dependencies.
    valid_nos = {s['no'] for s in steps}
    edges = []
    seen_edges = set()
    any_dep = False
    for s in steps:
        for d in s['depends']:
            if d in valid_nos and d != s['no'] and (d, s['no']) not in seen_edges:
                edges.append((d, s['no']))
                seen_edges.add((d, s['no']))
                any_dep = True

    # Fallback: if the plan declared NO dependencies anywhere, chain steps
    # linearly in author order so the graph is still a readable sequence.
    if not any_dep and len(steps) > 1:
        ordered = sorted(steps, key=lambda s: s['no'])
        for a, b in zip(ordered, ordered[1:]):
            edges.append((a['no'], b['no']))

    return {'steps': steps, 'edges': edges}


def layout_positions(steps, edges):
    """Assign pos_x/pos_y by dependency depth (layered left->right).

    Depth = longest dependency chain ending at a node. Nodes at the same depth
    stack vertically. Returns {step_no: (x, y)}."""
    preds = {s['no']: [] for s in steps}
    for a, b in edges:
        if b in preds:
            preds[b].append(a)

    depth = {}

    def _depth(n, seen):
        if n in depth:
            return depth[n]
        if n in seen:  # cycle guard
            return 0
        seen = seen | {n}
        d = 0 if not preds.get(n) else 1 + max((_depth(p, seen) for p in preds[n]), default=-1)
        depth[n] = d
        return d

    for s in steps:
        _depth(s['no'], set())

    # group by depth, assign coordinates
    by_depth = {}
    for s in steps:
        by_depth.setdefault(depth[s['no']], []).append(s['no'])

    X_GAP, Y_GAP, X0, Y0 = 240.0, 130.0, 80.0, 80.0
    pos = {}
    for d in sorted(by_depth):
        col = sorted(by_depth[d])
        for i, no in enumerate(col):
            pos[no] = (X0 + d * X_GAP, Y0 + i * Y_GAP)
    return pos


def build_notes(step):
    """Fold day/category/materials/protocols/detail into a single notes string,
    since pipeline_steps has only a `notes` field."""
    bits = []
    if step.get('day'):
        bits.append('Day: ' + step['day'])
    if step.get('category'):
        bits.append('Category: ' + step['category'])
    if step.get('materials'):
        bits.append('Materials: ' + step['materials'])
    if step.get('protocols'):
        bits.append('Protocols: ' + step['protocols'])
    if step.get('detail'):
        bits.append(step['detail'])
    return '\n'.join(bits)


def reconcile(new_steps, existing_steps):
    """Position-match parsed plan steps against existing pipeline steps.

    Matching is by 1-based position: the Nth parsed step corresponds to the Nth
    existing step (existing_steps must be ordered, e.g. by id or a stored order).
    A step is 'changed' when its TITLE differs from the existing step at that
    position; 'unchanged' otherwise (even if notes differ — those still get
    refreshed on commit, but the node keeps its position and isn't flagged).

    Returns a list of action dicts, one per position, each:
      {action: 'keep'|'change'|'add'|'remove',
       pos: 1-based position,
       new: <parsed step or None>,
       old: {id,name,notes,pos_x,pos_y} or None}
    Plus edges (by position) so the caller can rebuild dependency links."""
    actions = []
    n = max(len(new_steps), len(existing_steps))
    # parsed steps sorted by author number; existing in given order
    ns = sorted(new_steps, key=lambda s: s['no'])
    for i in range(n):
        new = ns[i] if i < len(ns) else None
        old = existing_steps[i] if i < len(existing_steps) else None
        if new and old:
            if new['title'].strip() == (old.get('name') or '').strip():
                actions.append({'action': 'keep', 'pos': i + 1, 'new': new, 'old': old})
            else:
                actions.append({'action': 'change', 'pos': i + 1, 'new': new, 'old': old})
        elif new and not old:
            actions.append({'action': 'add', 'pos': i + 1, 'new': new, 'old': None})
        elif old and not new:
            actions.append({'action': 'remove', 'pos': i + 1, 'new': None, 'old': old})
    return actions
