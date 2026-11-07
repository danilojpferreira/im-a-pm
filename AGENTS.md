# Working on this repository

This repository *is* the im-a-pm skill. These notes are for agents and people changing it. To
*use* the skill on another codebase, see the README.

- `skills/im-a-pm/` is the skill: `SKILL.md` (the workflow), `reference/` (schema and entrypoint
  guide), `scripts/im-a-pm.mjs` (the helper CLI, Node 18+, no dependencies) and
  `assets/viewer.html` (the viewer template).
- `skills/imapm/` is an alias. Keep it a thin pointer to `../im-a-pm/SKILL.md`. Never copy
  instructions into it.
- Keep the CLI dependency-free and the viewer a single self-contained file. Only Google Fonts may
  be loaded from outside.
- When you change the `flows.json` format, update `reference/schema.md`, `validate()` and both
  examples together. `examples/video-api/` came from a real run. `examples/shop/` is written for
  the docs: edit `examples/shop/make-map.mjs`, run it, then re-render `index.html`.
- README screenshots in `docs/` are taken from `examples/shop/index.html` at 2x. Retake them
  when the viewer's look changes.
- Before committing, run `npm test` and `npm run check`.
