"""The analyzer on Render is reachable by anyone; the server key keeps it to its owner."""
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

import main
from services import server_key

KEY = "k3y-for-tests-0123456789abcdef"
ORIGIN = "chrome-extension://" + "a" * 32


@pytest.fixture(autouse=True)
def fresh_limits():
    server_key._hits.clear()
    yield
    server_key._hits.clear()


@pytest.fixture
def client():
    return TestClient(main.app)


def test_the_local_server_without_a_key_stays_open(client):
    assert client.get("/pitch-config").status_code == 200


def test_with_a_key_configured_a_request_without_it_is_refused(client, monkeypatch):
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    r = client.get("/pitch-config")
    assert r.status_code == 401
    assert KEY not in r.text                                   # never echoed back


def test_a_wrong_key_is_refused_and_the_right_one_accepted(client, monkeypatch):
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    assert client.get("/pitch-config", headers={"X-Api-Key": "guess"}).status_code == 401
    assert client.get("/pitch-config", headers={"X-Api-Key": KEY}).status_code == 200


def test_writes_need_the_key_too(client, monkeypatch):
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    assert client.post("/pitch-config", json={"who": "attacker"}).status_code == 401


def test_on_render_a_missing_key_closes_the_server_instead_of_opening_it(client, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    r = client.get("/pitch-config")
    assert r.status_code == 503 and "ANALYZER_API_KEY" in r.json()["detail"]


def test_health_answers_without_a_key(client, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    assert client.get("/health").status_code == 200
    assert client.get("/").status_code == 200


def test_the_extension_may_send_the_key_header(client):
    r = client.options("/analyze", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
                                            "Access-Control-Request-Headers": "x-api-key, content-type"})
    assert "x-api-key" in r.headers.get("access-control-allow-headers", "").lower()


def test_one_client_is_limited_per_minute(client, monkeypatch):
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    h = {"X-Api-Key": KEY, "X-Forwarded-For": "203.0.113.7"}
    assert [client.get("/pitch-config", headers=h).status_code for _ in range(3)] == [200] * 3
    r = client.get("/pitch-config", headers=h)
    assert r.status_code == 429 and r.headers["retry-after"] == "60"


def test_a_forged_forwarded_for_entry_does_not_dodge_the_limit(client, monkeypatch):
    """Render appends the real address last; whatever the client wrote before it is ignored."""
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "2")
    codes = [client.get("/pitch-config", headers={"X-Api-Key": KEY,
                                                      "X-Forwarded-For": f"10.0.0.{i}, 203.0.113.7"}).status_code
             for i in range(3)]
    assert codes == [200, 200, 429]


def test_a_wrong_key_counts_against_the_limit(client, monkeypatch):
    monkeypatch.setenv("ANALYZER_API_KEY", KEY)
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "2")
    h = {"X-Api-Key": "guess", "X-Forwarded-For": "198.51.100.9"}
    assert [client.get("/pitch-config", headers=h).status_code for _ in range(3)] == [401, 401, 429]


@pytest.mark.parametrize("env", [{"ANALYZER_API_KEY": KEY}, {"RENDER": "true"}])
def test_a_public_server_does_not_publish_its_api_map(env):
    code = ("import main; from fastapi.testclient import TestClient; c = TestClient(main.app); "
            "print(c.get('/docs').status_code, c.get('/openapi.json').status_code)")
    run_env = {**os.environ, **env, "PYTHONIOENCODING": "utf-8"}
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=run_env,
                         cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    assert out.stdout.split()[-2:] == ["404", "404"], out.stderr[-500:]


def test_the_local_server_keeps_its_docs():
    assert main.app.openapi_url == "/openapi.json"
