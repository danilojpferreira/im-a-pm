---
name: iampm
description: Short alias of the i-am-pm skill. Maps a codebase as business flows for product managers (every entrypoint as a flowchart of business decisions, with the functions behind each step), keeps the map in sync with the code, and opens it in the browser. Commands are /iampm build, sync, view, ask "<question>", change <flow>[/<node>] "<request>", inbox, and diff [<base-ref>].
---

# iampm: alias of i-am-pm

This skill is a short name for **i-am-pm**. It has no instructions of its own.

1. Read `../i-am-pm/SKILL.md`. This is the `i-am-pm` skill folder, installed next to this one.
2. Follow it exactly, with the same arguments. For example, `/iampm sync` means `/i-am-pm sync`.

The helper script, references and viewer all live in `../i-am-pm/` (`scripts/`, `reference/`
and `assets/`).

If `../i-am-pm/` is missing, tell the person that both skill folders must be installed together.
They can run `npx github:danilojpferreira/i-am-pm install`, or see the README at
https://github.com/danilojpferreira/i-am-pm.
