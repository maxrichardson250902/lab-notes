"""Project timeline feature — chronological view of project entries."""
from fastapi import APIRouter
from core.database import get_db

router = APIRouter(prefix="/api", tags=["timeline"])

@router.get("/timeline")
def get_all_timelines():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT group_name, date, COUNT(*) as count,
                   GROUP_CONCAT(title, ' | ') as titles
            FROM entries WHERE group_name != ''
            GROUP BY group_name, date
            ORDER BY group_name, date ASC
        """).fetchall()
    projects = {}
    for r in rows:
        g = r["group_name"]
        if g not in projects:
            projects[g] = {"group_name": g, "days": [], "entry_count": 0}
        projects[g]["days"].append({
            "date": r["date"],
            "count": r["count"],
            "titles": r["titles"][:300] if r["titles"] else "",
        })
        projects[g]["entry_count"] += r["count"]
    return {"projects": list(projects.values())}

@router.get("/timeline/{group_name}")
def get_project_timeline(group_name: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM entries WHERE group_name=? ORDER BY date ASC, created ASC",
            (group_name,)).fetchall()
    entries = [dict(r) for r in rows]
    by_date = {}
    for e in entries:
        by_date.setdefault(e["date"], []).append(e)
    days = [{"date": d, "entries": es} for d, es in sorted(by_date.items())]
    return {"group_name": group_name, "days": days, "total": len(entries)}
