"""Saved settings survive a bad file and a crash mid-save; errors don't leak internals."""
import json
import os

import pytest
from fastapi.testclient import TestClient

import main
from routers import common
from services import config_store


def _clean(saved):
    return {"who": "default"} if saved is None else dict(saved)


def test_a_missing_file_means_the_defaults(tmp_path):
    assert config_store.read_config(str(tmp_path / "pitch.json"), _clean) == {"who": "default"}


def test_a_save_round_trips_and_leaves_no_temp_files(tmp_path):
    path = str(tmp_path / "pitch.json")
    assert config_store.write_config(path, {"who": "Harsh"}) == {"who": "Harsh"}
    assert config_store.read_config(path, _clean) == {"who": "Harsh"}
    assert os.listdir(tmp_path) == ["pitch.json"]


def test_a_corrupt_file_is_kept_aside_not_overwritten_later(tmp_path):
    path = tmp_path / "pitch.json"
    path.write_text('{"who": "Harsh", ', encoding="utf-8")         # cut off mid-write by an old crash
    assert config_store.read_config(str(path), _clean) == {"who": "default"}
    assert (tmp_path / "pitch.json.corrupt").read_text(encoding="utf-8") == '{"who": "Harsh", '


def test_a_failed_save_keeps_the_old_file_whole(tmp_path):
    path = str(tmp_path / "pitch.json")
    config_store.write_config(path, {"who": "Harsh"})
    with pytest.raises(TypeError):
        config_store.write_config(path, {"who": object()})          # not JSON: fails mid-dump
    assert json.loads(open(path, encoding="utf-8").read()) == {"who": "Harsh"}
    assert os.listdir(tmp_path) == ["pitch.json"]


def test_an_unexpected_error_is_logged_not_sent_to_the_client(monkeypatch):
    def boom(url, n=None, errors=None):
        raise RuntimeError("secret internal detail: actor xyz, token abc")
    monkeypatch.setattr(common, "fetch_profile_and_posts", boom)
    monkeypatch.setattr("routers.analyze.profile_from_form", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret")))
    r = TestClient(main.app).post("/analyze", json={"name": "X"})
    assert r.status_code == 500
    assert "secret" not in r.text and "see the server log" in r.json()["detail"]
