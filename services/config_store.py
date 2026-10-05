"""Reading and writing the editable settings files.

Every setting the extension can change — ICP keywords, Activity points, Activity
requirements, signal keywords, the pitch — is one JSON file next to the server, saved
whole and read back merged over the defaults. Each of those used to carry its own copy
of the same eight lines: `os.path.exists`, `open`, `json.load`, and a bare `except` that
falls back to the defaults.

The rule they all share is the one worth stating once: **a settings file that is
missing, unreadable or malformed is not an error.** It means nothing has been saved yet,
so the defaults answer instead, and the server keeps scoring rather than failing at
startup over a stray comma.
"""
from __future__ import annotations

import json
import os


def read_config(path: str, clean):
    """What is saved at `path`, run through `clean`.

    `clean` is handed the parsed JSON, or `None` when there is nothing usable to read —
    so it owns both merging a saved file over the defaults and producing those defaults
    on their own. It must return a fresh object every time: the value goes straight to a
    caller who may mutate it, and the defaults it was built from must not travel with it.
    """
    saved = None
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
    except Exception:
        pass
    return clean(saved)


def write_config(path: str, values):
    """Save `values` to `path` and hand them back, so callers can `return write_config(...)`."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(values, f, indent=2, ensure_ascii=False)
    return values
