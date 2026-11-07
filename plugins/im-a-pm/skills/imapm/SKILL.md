---
name: imapm
description: Short alias of the im-a-pm skill. Maps a codebase as business flows for product managers (every entrypoint as a flowchart of business decisions, with the functions behind each step), keeps the map in sync with the code, and opens it in the browser. Commands are /imapm build, sync, view, ask "<question>", change <flow>[/<node>] "<request>", and diff [<base-ref>].
---

# imapm: alias of im-a-pm

This skill is a short name for **im-a-pm**. It has no instructions of its own.

1. Read `../im-a-pm/SKILL.md`. This is the `im-a-pm` skill folder, installed next to this one.
2. Follow it exactly, with the same arguments. For example, `/imapm sync` means `/im-a-pm sync`.

The helper script, references and viewer all live in `../im-a-pm/` (`scripts/`, `reference/`
and `assets/`).

If `../im-a-pm/` is missing, tell the person that both skill folders must be installed together.
They can run `npx github:danilojpferreira/im-a-pm install`, or see the README at
https://github.com/danilojpferreira/im-a-pm.
