"""Reading and writing the editable settings files (the pitch, saved Activity defaults).

Each is one JSON file next to the server, saved whole and read back merged over the
defaults.

A file that is missing means nothing has been saved yet: the defaults answer. A file that
exists but can't be read is different - somebody's settings are in it - so it is logged
and moved aside (`<name>.corrupt`) instead of being silently overwritten by the next save.
Writes go to a temporary file first and replace the real one in one step, so a crash or a
full disk mid-save can never leave half a file behind.

On Render the disk is wiped on every deploy, so anything saved there lasts only until the
next one; per-user settings belong in the admin's database instead.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile

log = logging.getLogger(__name__)


def read_config(path: str, clean):
    """What is saved at `path`, run through `clean`.

    `clean` is handed the parsed JSON, or `None` when there is nothing usable to read -
    so it owns both merging a saved file over the defaults and producing those defaults
    on their own. It must return a fresh object every time: the value goes straight to a
    caller who may mutate it, and the defaults it was built from must not travel with it.
    """
    if not os.path.exists(path):
        return clean(None)
    try:
        with open(path, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, ValueError) as e:
        aside = path + ".corrupt"
        log.error("settings file %s could not be read (%s); moved to %s, defaults used", path, e, aside)
        try:
            os.replace(path, aside)
        except OSError:
            pass
        saved = None
    return clean(saved)


def write_config(path: str, values):
    """Save `values` to `path` atomically and hand them back, so callers can `return write_config(...)`."""
    folder = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(values, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    return values
