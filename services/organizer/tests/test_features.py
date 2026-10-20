from __future__ import annotations

from pathlib import Path


def _scan(client, headers, path):
    response = client.post("/api/scan", json={"path": str(path)}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["session"]["id"]


def test_duplicate_detection_groups_exact_matches(client, auth_headers, tmp_path: Path):
    root = tmp_path / "dupes"
    (root / "a").mkdir(parents=True)
    (root / "b").mkdir(parents=True)
    payload = b"identical-bytes" * 100
    (root / "a" / "one.bin").write_bytes(payload)
    (root / "b" / "two.bin").write_bytes(payload)
    (root / "b" / "different.bin").write_bytes(b"unique")
    (root / "empty.txt").write_text("", encoding="utf-8")

    response = client.post(
        "/api/duplicates/scan", json={"path": str(root)}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["groups"]) == 1
    group = body["groups"][0]
    assert group["count"] == 2
    assert group["potential_savings"] == len(payload)
    assert {file["name"] for file in group["files"]} == {"one.bin", "two.bin"}

    dashboard = client.get("/api/dashboard", headers=auth_headers).json()
    assert dashboard["duplicate_groups"] == 1
    assert dashboard["duplicate_bytes"] == len(payload)


def test_search_uses_metadata_and_never_needs_ai(client, auth_headers, messy_folder: Path):
    _scan(client, auth_headers, messy_folder)
    response = client.post(
        "/api/search",
        json={"query": "find pdf documents", "use_ai": False},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    names = [hit["name"] for hit in body["hits"]]
    assert "report.pdf" in names
    assert body["semantic"] is False

    python = client.post(
        "/api/search",
        json={"query": "find my python projects", "use_ai": False},
        headers=auth_headers,
    ).json()
    assert any(hit["name"] == "script.py" for hit in python["hits"])
    assert python["filters"]["category"] == "Projects" or "py" in python["filters"]["extensions"]


def test_search_large_video_filter(client, auth_headers, tmp_path: Path):
    root = tmp_path / "videos"
    root.mkdir()
    (root / "big.mp4").write_bytes(b"0" * (2 * 1024 * 1024))
    (root / "notes.txt").write_text("not a video", encoding="utf-8")
    _scan(client, auth_headers, root)
    response = client.post(
        "/api/search",
        json={"query": "large video files", "use_ai": False},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["filters"]["category"] == "Videos"
    assert body["filters"]["min_size_mb"] == 100
    assert body["hits"] == []


def test_settings_never_return_secrets(client, auth_headers):
    response = client.patch(
        "/api/settings",
        json={
            "provider": "gemini",
            "cloud_consent": True,
            "api_keys": {"gemini": "super-secret-key"},
            "models": {"gemini": "gemini-2.5-flash"},
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "gemini"
    assert body["cloud_consent"] is True
    assert body["api_keys_configured"]["gemini"] is True
    assert "super-secret-key" not in response.text

    providers = client.get("/api/ai/providers", headers=auth_headers).json()
    gemini = next(item for item in providers if item["id"] == "gemini")
    assert gemini["configured"] is True
    assert gemini["selected"] is True


def test_automation_rule_run_creates_pending_review(client, auth_headers, messy_folder: Path):
    create = client.post(
        "/api/automation/rules",
        json={
            "name": "Downloads cleanup",
            "root_path": str(messy_folder),
            "enabled": True,
            "interval_minutes": 60,
            "auto_apply": False,
        },
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    rule = create.json()
    assert rule["enabled"] is True
    assert rule["auto_apply"] is False

    run = client.post(f"/api/automation/rules/{rule['id']}/run", headers=auth_headers)
    assert run.status_code == 200, run.text
    result = run.json()
    assert result["status"] == "pending_review"
    assert result["planned"] == 7
    assert result["applied"] == 0
    # Without auto-apply nothing may move.
    assert (messy_folder / "report.pdf").exists()

    pending = client.get("/api/automation/pending", headers=auth_headers).json()
    assert len(pending["pending"]) == 1
    assert pending["pending"][0]["planned"] == 7

    overview = client.get("/api/automation", headers=auth_headers).json()
    assert len(overview["rules"]) == 1
    assert overview["status"]["active_rules"] == 1


def test_reveal_is_limited_to_approved_roots(client, auth_headers, tmp_path: Path):
    outsider = tmp_path / "outside.txt"
    outsider.write_text("not approved", encoding="utf-8")
    response = client.post(
        "/api/files/reveal", json={"path": str(outsider)}, headers=auth_headers
    )
    assert response.status_code == 403


def test_index_status_empty(client, auth_headers):
    status = client.get("/api/search/index/status", headers=auth_headers)
    assert status.status_code == 200
    assert status.json()["indexed"] == 0


def test_dashboard_counts(client, auth_headers, messy_folder: Path):
    _scan(client, auth_headers, messy_folder)
    dashboard = client.get("/api/dashboard", headers=auth_headers).json()
    assert dashboard["files_indexed"] == 7
    assert dashboard["sessions"] == 1
    assert dashboard["total_bytes"] > 0
    assert dashboard["ai"]["rules_available"] is True
    assert dashboard["recent_sessions"][0]["root_path"].endswith("MessyDownloads")
