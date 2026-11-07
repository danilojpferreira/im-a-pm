# Working on this repository

This repository *is* the im-a-pm skill. These notes are for agents and people changing it. To
*use* the skill on another codebase, see the README.

## Layout

- `skills/im-a-pm/` is the skill: `SKILL.md` (the workflow), `reference/` (schema and entrypoint
  guide), `scripts/im-a-pm.mjs` (the helper CLI, Node 18+, no dependencies) and
  `assets/viewer.html` (the viewer template).
- `skills/imapm/` is an alias. Keep it a thin pointer to `../im-a-pm/SKILL.md`. Never copy
  instructions into it. The only text it repeats is the "Commands are …" sentence of its
  description. `npm test` checks that sentence against `skills/im-a-pm/SKILL.md`, and checks that
  every command listed there has its own `## /im-a-pm <command>` section.
- Keep the CLI dependency-free and the viewer a single self-contained file. Only Google Fonts may
  be loaded from outside.

## Changing the `flows.json` format

- Change these together: `reference/schema.md`, `validate()`, `diff()` (when the field changes
  business behavior), `assets/viewer.html`, `SKILL.md`, and both examples.
- Maps are committed in the repositories that use the skill. Follow "Changing this format" in
  `reference/schema.md`: while `version` is 1, a new check is a warning. A check becomes an error
  only with a new `version`, together with notes on how to move a map to it.

## Examples

`npm run examples` regenerates everything that is generated under `examples/`. `npm run check`
does the same, then fails if anything there changed. Commit what it regenerated. Do not render
the examples by hand: `render` without `--out` writes `view.json` and starts a server inside the
example's folder.

- `examples/shop/` is written for the docs. Change its code in `src/` and `web/src/`, or the map
  in `make-map.mjs`, then run `npm run examples`.
- `examples/video-api/` is the frozen record of a real run on the repository and commit in its
  `app.repo` and `app.commit`. When the format changes, edit its `flows.json` and `base.json` by
  hand, only as far as the new format needs. `npm run examples` then redoes `index.html`,
  `diff.txt` and `trace-publish-video.txt`. `sync-report.txt`, `teammate-commit.diff` and
  `change-published-only.diff` record what happened in that run: never regenerate or edit them.

## README screenshots

Take them from `examples/shop/index.html` at a device scale factor of 2. Retake all of them when
the viewer's look changes. Sizes are in CSS pixels; the files are twice as large.

| File | Theme | Size | What it shows |
|---|---|---|---|
| `hero.png` | light | 1280×840 | `place-order`, "Show changes" off, step `approved` selected and scrolled into view |
| `hero-dark.png` | dark | 1280×840 | The same view as `hero.png` |
| `changes.png` | light | 1280×900 | `place-order`, "Show changes" on, the list of changes open, step `add-fee` selected |
| `actions.png` | light | 320×853, inspector only | `place-order`, step `attempts-left` selected |
| `actions-request.png` | light | 320×853, inspector only | As `actions.png`, with "Request a change" open and "Retry up to 5 times, and wait 30 seconds before the last attempt" typed in |
| `undeclared.png` | light | 555×804, canvas only | `place-order`, the path to `charged-no-order` selected |
| `loop.png` | light | 822×441, flow list and canvas | `place-order`, the retry loop around `attempts-left` and `wait` |
| `parallel.png` | light | 1392×1153 | `ship-order`, findings open, step `request-shipment` selected |
| `batch.png` | light | 1392×1153 | `invoice-nightly`, findings open, step `read-batch` selected |
| `frontend.png` | light | 1280×900 | `pay-for-order`, step `send-order` selected |
| `frontend-rule.png` | light | 320×853, inspector only | `open-checkout`, step `free-shipping` selected |

## Versions

`package.json` and `.claude-plugin/plugin.json` carry the same version, and the README's
"**Status: version X.Y.**" line names its major and minor. Change all three together. `npm test`
checks them.

## Code style

- Every declaration has a JSDoc comment, in the CLI, the tests, `make-map.mjs` and the viewer's
  script. It says what the declaration does, functionally, for whoever reads it. It never holds
  decisions, rationale, history, dates, PR numbers or references to other documents.
- No other comments: no inline notes, no section dividers, no commented-out code.
- Code that does not follow this yet is brought in line whenever a declaration in it changes.

## Before committing

Run `npm test` and `npm run check`. Both must pass. CI runs both on Linux with the oldest and the
newest supported Node, and on macOS and Windows with the newest, as listed in
`.github/workflows/ci.yml`.
