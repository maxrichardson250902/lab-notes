"""
Lab Notes — notebook + protocol library
Runs on port 3003

Slim entrypoint: creates the app, discovers features, serves static files.
All business logic lives in features/ sub-packages.
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from core.database import init_all_tables
from features import discover_features

app = FastAPI(title="Lab Notes")

# ── Discover and mount all feature routers ────────────────────────────────────
print("Loading features...")
discover_features(app)

# ── Static files ─────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    init_all_tables()
    print("Database tables initialised.")
