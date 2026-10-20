# Demo folder

`MessyDownloads/` contains **fictional placeholder files** for trying LazyDesk safely. None of the text inside them is real personal or financial data, and the binary-looking files are plain text placeholders.

To try the full workflow, copy the folder somewhere writable first:

```bash
cp -r demo/MessyDownloads ~/Desktop/LazyDeskDemo
```

Then scan that copy in the Organize page. Expected classifications:

| File | Category |
|---|---|
| `tax_return_2024.pdf` | Documents |
| `project_notes.md` | Documents (AI may suggest Projects) |
| `vacation_photo.jpg` | Images |
| `nested/lecture_recording.mp4` | Videos |
| `song_idea.mp3` | Audio |
| `script.py` | Source Code |
| `presentation_draft.pptx` | Presentations |
| `q4_budget.xlsx` | Spreadsheets |
| `archive_backup.zip` | Archives |
| `install_rustup.exe` | Installers |
| `mystery.xyz` | Other (a good AI test case) |

The automated tests never modify this folder; they build their own files in temporary directories.
