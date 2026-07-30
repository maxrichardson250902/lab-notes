"""
Feature auto-discovery.
Each sub-package exposes a `router` (APIRouter) and optionally a `tables` list.
Call discover_features(app) from main.py to mount them all.
"""
import importlib, pkgutil, pathlib, traceback
from fastapi import FastAPI, APIRouter


def discover_features(app: FastAPI):
    """
    Walk every sub-package under features/.
    Each must have a router.py that exposes:
      - router : APIRouter          (required)
    Tables are registered by feature modules at import time via core.database.register_table().

    Import failures print a full traceback rather than just the exception
    message — because a feature that silently fails to import also silently
    fails to register its tables, and downstream features that query those
    tables die with confusing errors that are hard to trace back without
    seeing where the original import broke.
    """
    features_dir = pathlib.Path(__file__).parent
    for info in pkgutil.iter_modules([str(features_dir)]):
        if not info.ispkg:
            continue
        try:
            mod = importlib.import_module(f"features.{info.name}.router")
            if hasattr(mod, "router") and isinstance(mod.router, APIRouter):
                app.include_router(mod.router)
                print(f"  ✓ feature: {info.name}")
            else:
                print(f"  ✗ feature: {info.name} (no router)")
        except Exception as e:
            print(f"  ✗ feature: {info.name} FAILED: {type(e).__name__}: {e}")
            traceback.print_exc()
