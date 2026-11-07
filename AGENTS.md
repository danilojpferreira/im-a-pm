# Working on this repository

This repository *is* the i-am-pm skill. These notes are for agents and people changing it. To
*use* the skill on another codebase, see the README.

- `skills/i-am-pm/` is the skill: `SKILL.md` (the workflow), `reference/` (schema and entrypoint
  guide), `scripts/i-am-pm.mjs` (the helper CLI, Node 18+, no dependencies) and
  `assets/viewer.html` (the viewer template).
- `skills/iampm/` is an alias. Keep it a thin pointer to `../i-am-pm/SKILL.md`. Never copy
  instructions into it.
- Keep the CLI dependency-free and the viewer a single self-contained file. Only Google Fonts may
  be loaded from outside.
- When you change the `flows.json` format, update `reference/schema.md`, `validate()` and the
  example in `examples/video-api/` together.
- Before committing, run `npm test` and `npm run check`.
