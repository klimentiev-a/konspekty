"""Project paths and settings. SQLite on start; swap DB_URL for PostgreSQL later."""
from __future__ import annotations

import os
from pathlib import Path

# backend/app/config.py -> project root is three parents up
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
FRONTEND_DIR = ROOT / "frontend"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Локальные секреты (MOEX_LOGIN / MOEX_PASSWORD, ADMIN_TOKEN …) — в backend/.env, строки KEY=VALUE.
# Файл заполняет владелец, в архив деплоя не попадает; на VPS — /etc/bonds-analytics.env (systemd).
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

DB_URL = os.environ.get("DB_URL", f"sqlite:///{DATA_DIR / 'bond_dashboard.db'}")

# Default history window for charts.
HISTORY_FROM = os.environ.get("HISTORY_FROM", "2025-01-01")
