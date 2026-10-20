from __future__ import annotations

import pytest

from organizer.ai.base import AIError, clamp_confidence, extract_json
from organizer.core.categories import extension_of, needs_ai, rule_category
from organizer.core.search import rule_parse_query
from organizer.filesystem.safety import sanitize_folder_name, unique_destination


@pytest.mark.parametrize(
    ("name", "category"),
    [
        ("report.pdf", "Documents"),
        ("photo.JPG", "Images"),
        ("movie.mp4", "Videos"),
        ("song.mp3", "Audio"),
        ("main.py", "Source Code"),
        ("deck.pptx", "Presentations"),
        ("budget.xlsx", "Spreadsheets"),
        ("backup.zip", "Archives"),
        ("setup.exe", "Installers"),
        ("package.json", "Projects"),
        ("mystery.xyz", "Other"),
    ],
)
def test_rule_categories(name, category):
    actual, confidence, _reason = rule_category(name)
    assert actual == category
    assert 0.0 <= confidence <= 1.0


def test_ambiguous_files_prefer_ai():
    assert needs_ai("data.bin", *rule_category("data.bin")[:2]) is True
    assert needs_ai("report.pdf", *rule_category("report.pdf")[:2]) is False


def test_extension_of_handles_uppercase_and_missing():
    assert extension_of("PHOTO.JPEG") == "jpeg"
    assert extension_of("Makefile") == ""


def test_extract_json_handles_fences_and_prose():
    payload = extract_json('Sure!\n```json\n{"items":[{"id":0,"category":"Images"}]}\n```')
    assert payload["items"][0]["category"] == "Images"

    array = extract_json('Here you go: [1, 2, 3] done')
    assert array == [1, 2, 3]

    with pytest.raises(AIError):
        extract_json("no json here")


def test_clamp_confidence():
    assert clamp_confidence("0.8") == 0.8
    assert clamp_confidence(-5) == 0.0
    assert clamp_confidence(9) == 1.0
    assert clamp_confidence("nope") == 0.5


def test_rule_parse_query():
    parsed = rule_parse_query("Find my large PDFs downloaded recently")
    assert parsed["extensions"] == ["pdf"]
    assert parsed["min_size_mb"] == 100
    assert parsed["modified_within_days"] == 7

    parsed = rule_parse_query("show python code")
    assert parsed["category"] == "Source Code"
    assert "py" in parsed["extensions"]


def test_sanitize_folder_name():
    assert sanitize_folder_name("Source Code") == "Source Code"
    assert sanitize_folder_name("../../evil") == "evil"
    assert sanitize_folder_name("CON") == "CON-files"
    assert sanitize_folder_name("   ") == "Other"
    assert "/" not in sanitize_folder_name("a/b")


def test_unique_destination(tmp_path):
    existing = tmp_path / "a.txt"
    existing.write_text("x", encoding="utf-8")
    final, renamed = unique_destination(existing)
    assert renamed is True
    assert final.name == "a (1).txt"

    taken: set[str] = set()
    fresh = tmp_path / "b.txt"
    first, renamed_first = unique_destination(fresh, taken)
    second, renamed_second = unique_destination(fresh, taken)
    assert renamed_first is False
    assert renamed_second is True
    assert first != second


def test_extra_allowed_origins_from_env(monkeypatch):
    """Hosted frontends are configured by URL, trimmed and never wildcarded."""
    from organizer.config import AppConfig

    monkeypatch.setenv(
        "LAZYDESK_ALLOWED_ORIGINS",
        " https://a.onrender.com , https://b.onrender.com/ ,, ",
    )
    assert AppConfig._extra_origins() == [
        "https://a.onrender.com",
        "https://b.onrender.com",
    ]

    monkeypatch.delenv("LAZYDESK_ALLOWED_ORIGINS")
    assert AppConfig._extra_origins() == []

    # A wildcard would defeat the origin check, so it is refused rather than
    # passed through to the CORS middleware.
    monkeypatch.setenv("LAZYDESK_ALLOWED_ORIGINS", "* , https://*.onrender.com")
    assert AppConfig._extra_origins() == []
