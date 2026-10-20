from __future__ import annotations

from pathlib import Path


def test_requires_token(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/settings").status_code == 401
    assert client.get("/api/dashboard").status_code == 401


def test_electron_origin_can_call_the_api(client, auth_headers):
    preflight = client.options(
        "/api/dashboard",
        headers={
            "Origin": "lazydesk://app",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-lazydesk-token",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "lazydesk://app"
    allowed = client.get(
        "/api/dashboard", headers={**auth_headers, "Origin": "lazydesk://app"}
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "lazydesk://app"


def test_scan_plan_apply_undo(client, auth_headers, messy_folder: Path):
    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    assert scan.status_code == 200, scan.text
    data = scan.json()
    assert data["session"]["file_count"] == 7
    assert len(data["files"]) == 7
    session_id = data["session"]["id"]

    plan = client.post(
        "/api/plan",
        json={"session_id": session_id, "use_ai": False, "ai_scope": "none"},
        headers=auth_headers,
    )
    assert plan.status_code == 200, plan.text
    plan_data = plan.json()
    assert len(plan_data["items"]) == 7
    destinations = {item["name"]: item["destination_path"] for item in plan_data["items"]}
    assert "Documents" in Path(destinations["report.pdf"]).parts
    assert "Images" in Path(destinations["photo.jpg"]).parts
    assert "Source-Code" in Path(destinations["script.py"]).parts
    assert "Videos" in Path(destinations["clip.mp4"]).parts

    preview = client.post(
        "/api/operations/preview",
        json={"session_id": session_id},
        headers=auth_headers,
    )
    assert preview.status_code == 200
    assert preview.json()["conflicts"] == 0
    assert preview.json()["can_apply"] is True

    apply = client.post(
        "/api/operations/apply",
        json={"session_id": session_id},
        headers=auth_headers,
    )
    assert apply.status_code == 200, apply.text
    result = apply.json()
    assert result["applied"] == 7
    assert result["failed"] == 0
    batch_id = result["batch_id"]
    assert batch_id

    assert (messy_folder / "Documents" / "report.pdf").exists()
    assert (messy_folder / "Videos" / "clip.mp4").exists()
    assert not (messy_folder / "report.pdf").exists()

    history = client.get("/api/history", headers=auth_headers)
    assert history.status_code == 200
    assert history.json()["batches"][0]["applied_count"] == 7

    undo = client.post(
        "/api/operations/undo", json={"batch_id": batch_id}, headers=auth_headers
    )
    assert undo.status_code == 200, undo.text
    assert undo.json()["restored"] == 7
    assert (messy_folder / "report.pdf").exists()
    assert not (messy_folder / "Documents" / "report.pdf").exists()

    # A second undo has nothing left to restore.
    second = client.post(
        "/api/operations/undo", json={"batch_id": batch_id}, headers=auth_headers
    )
    assert second.json()["restored"] == 0


def test_conflict_is_renamed_and_original_preserved(client, auth_headers, messy_folder: Path):
    docs = messy_folder / "Documents"
    docs.mkdir()
    existing = docs / "report.pdf"
    existing.write_text("already here", encoding="utf-8")

    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    session_id = scan.json()["session"]["id"]
    plan = client.post(
        "/api/plan",
        json={"session_id": session_id, "use_ai": False, "ai_scope": "none"},
        headers=auth_headers,
    )
    report_item = next(
        item for item in plan.json()["items"] if item["name"] == "report.pdf"
    )
    assert report_item["conflict"] is True
    assert report_item["destination_path"].endswith("report (1).pdf")

    apply = client.post(
        "/api/operations/apply",
        json={"session_id": session_id},
        headers=auth_headers,
    )
    assert apply.status_code == 200
    assert apply.json()["applied"] == 7
    assert existing.read_text(encoding="utf-8") == "already here"
    assert (docs / "report (1).pdf").exists()


def test_skip_conflicts_never_overwrites(client, auth_headers, messy_folder: Path):
    docs = messy_folder / "Documents"
    docs.mkdir()
    existing = docs / "report.pdf"
    existing.write_text("keep me", encoding="utf-8")

    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    session_id = scan.json()["session"]["id"]
    client.post(
        "/api/plan",
        json={"session_id": session_id, "use_ai": False, "ai_scope": "none"},
        headers=auth_headers,
    )
    apply = client.post(
        "/api/operations/apply",
        json={"session_id": session_id, "resolve_conflicts": False},
        headers=auth_headers,
    )
    assert apply.status_code == 200
    assert apply.json()["skipped"] == 1
    assert existing.read_text(encoding="utf-8") == "keep me"
    assert (messy_folder / "report.pdf").exists()


def test_undo_refuses_when_original_location_is_occupied(client, auth_headers, messy_folder: Path):
    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    session_id = scan.json()["session"]["id"]
    client.post(
        "/api/plan",
        json={"session_id": session_id, "use_ai": False, "ai_scope": "none"},
        headers=auth_headers,
    )
    apply = client.post(
        "/api/operations/apply", json={"session_id": session_id}, headers=auth_headers
    )
    batch_id = apply.json()["batch_id"]

    # Simulate a new file appearing where the original used to be.
    (messy_folder / "report.pdf").write_text("new file", encoding="utf-8")
    undo = client.post(
        "/api/operations/undo", json={"batch_id": batch_id}, headers=auth_headers
    )
    assert undo.status_code == 200
    body = undo.json()
    assert body["restored"] == 6
    assert body["failed"] == 1
    assert (messy_folder / "report.pdf").read_text(encoding="utf-8") == "new file"
    # The moved duplicate is still safe in Documents.
    assert (messy_folder / "Documents" / "report.pdf").exists()


def test_categorize_flags_rule_fallback(client, auth_headers, messy_folder: Path):
    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    session_id = scan.json()["session"]["id"]
    response = client.post(
        "/api/categorize",
        json={"session_id": session_id, "use_ai": True, "ai_scope": "all"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ai_used"] is False
    assert body["provider"] is None
    assert any("Rule-based" in warning or "rules" in warning for warning in body["warnings"])
    categories = {item["name"]: item["category"] for item in body["files"]}
    assert categories["report.pdf"] == "Documents"
    assert categories["mystery.xyz"] == "Other"


def test_plan_sanitizes_malicious_folder_names(client, auth_headers, messy_folder: Path):
    scan = client.post("/api/scan", json={"path": str(messy_folder)}, headers=auth_headers)
    session_id = scan.json()["session"]["id"]
    plan = client.post(
        "/api/plan",
        json={
            "session_id": session_id,
            "use_ai": False,
            "ai_scope": "none",
            "folder_names": {
                "Documents": "../../escape",
                "Images": "/tmp/absolute",
                "Source Code": "..",
            },
        },
        headers=auth_headers,
    )
    assert plan.status_code == 200, plan.text
    root = messy_folder.resolve()
    for item in plan.json()["items"]:
        destination = Path(item["destination_path"]).resolve()
        assert destination.is_relative_to(root), destination
        assert ".." not in destination.relative_to(root).parts


def test_scan_rejects_protected_and_missing_paths(client, auth_headers, tmp_path):
    missing = client.post(
        "/api/scan", json={"path": str(tmp_path / "does-not-exist")}, headers=auth_headers
    )
    assert missing.status_code == 400

    file_path = tmp_path / "a-file.txt"
    file_path.write_text("not a folder", encoding="utf-8")
    not_dir = client.post("/api/scan", json={"path": str(file_path)}, headers=auth_headers)
    assert not_dir.status_code == 400


def test_hidden_and_symlink_entries_are_skipped(client, auth_headers, tmp_path):
    root = tmp_path / "mixed"
    root.mkdir()
    (root / "visible.txt").write_text("hi", encoding="utf-8")
    (root / ".hidden.txt").write_text("secret", encoding="utf-8")
    try:
        (root / "link.txt").symlink_to(root / "visible.txt")
    except (OSError, NotImplementedError):
        pass

    scan = client.post("/api/scan", json={"path": str(root)}, headers=auth_headers)
    assert scan.status_code == 200
    names = [item["name"] for item in scan.json()["files"]]
    assert "visible.txt" in names
    assert ".hidden.txt" not in names
    assert "link.txt" not in names
