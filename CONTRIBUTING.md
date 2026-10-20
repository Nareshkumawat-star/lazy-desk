# Contributing to LazyDesk

Thanks for helping make file organization less boring. Contributions of all sizes are welcome.

## Ground rules

1. **Never add an automatic delete or overwrite.** LazyDesk proposes changes, users approve them, and conflicts must be preserved.
2. **Cloud AI stays opt-in.** Do not send file contents, full paths or metadata to a provider without an explicit consent setting and clear UI copy.
3. **The rules fallback must keep working.** Every AI feature needs a deterministic path and a test for the unavailable case.
4. **No secrets in the repository.** API keys are stored in the local SQLite settings table and must never be returned by an API response or logged.
5. **Tests must use temporary folders.** Never modify `demo/MessyDownloads` or a contributor's real files in a test.

## Development setup

```bash
npm install
cd services/organizer
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
.venv/bin/python -m pip install -r requirements.txt            # macOS/Linux
cd ../..
npm run dev
```

Useful commands:

```bash
npm run dev              # browser preview + Python service
npm run dev:desktop      # same, inside Electron
npm run test             # Vitest + pytest
npm run test:backend     # pytest only
npm run typecheck        # TypeScript
npm run build:web        # static export
npm run package          # Electron Forge package
```

## Code style

- Python: Ruff with a 100-character line length, type hints on public functions, Pydantic schemas for API boundaries.
- TypeScript: strict mode, functional components, shared API types in `shared/types`.
- UI: reuse the primitives in `apps/web/components/ui.tsx`; keep keyboard focus visible and labels associated.
- Keep API types in sync between `services/organizer/organizer/schemas.py` and `shared/types/index.ts`.

## Adding an AI provider

1. Add a `ProviderMeta` entry in `services/organizer/organizer/ai/providers.py`.
2. Implement `chat_json`, `health`, `list_models`; implement `embed` only if the provider supports embeddings.
3. Add the provider to `PROVIDERS`, defaults and `build_provider`.
4. Make it discoverable in `describe_providers` (the Settings UI reads that list).
5. Document free-tier limits and licensing in the README.
6. Add a test that proves the rules fallback still works when the provider is unavailable.

## Reporting bugs

Include the OS, how you launched LazyDesk, the folder type involved (not private paths), whether AI was enabled, and the relevant local service log. Redact personal paths.

## Security issues

Please do not open a public issue for a path-traversal, token or overwrite vulnerability. Contact the maintainer privately and include a minimal reproduction.
