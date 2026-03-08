"""
Feature auto-discovery.
Each sub-package exposes a `router` (APIRouter) and optionally a `tables` list.
Call discover_features(app) from main.py to mount them all.
"""
import importlib, pkgutil, pathlib
from fastapi import FastAPI, APIRouter


def discover_features(app: FastAPI):
    """
    Walk every sub-package under features/.
    Each must have a router.py that exposes:
      - router : APIRouter          (required)
    Tables are registered by feature modules at import time via core.database.register_table().
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
            print(f"  ✗ feature: {info.name} FAILED: {e}")
