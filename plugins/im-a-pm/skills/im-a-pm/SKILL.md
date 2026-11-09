---
name: im-a-pm
description: Map a codebase as business flows for product managers. Every entrypoint (REST, GraphQL, queues, events, jobs, cron, sagas, webhooks, and the screens and actions of a web or mobile frontend) becomes a flowchart of business decisions from trigger to outcome, with the functions that run at each step in order, and the map is kept in sync with the code and opened in the browser. Use when someone asks how a feature or business rule works in product terms, wants a PM-readable map of the app, wants to update the map after code changes, wants to change a business rule from the map, or wants to see which business behavior a branch or PR changes. Commands are /im-a-pm build, sync, view, ask "<question>", change <flow>[/<node>] "<request>", and diff [<base-ref>]. /imapm is an alias.
---

# im-a-pm

im-a-pm turns a repository into **business flows**: one flowchart per entrypoint, written for a
product manager. A node is one of these:
- a business decision
- a business action
- information being saved or read
- a call to the outside world
- an outcome the user sees

Functions are never nodes. Instead, each node records **the functions that run for it, in order**
(`calls`). A path from trigger to outcome therefore gives the exact function order of that path.
This is the engineer's view. It is also what lets `sync` tell which steps a code change touches.

## Where it runs

Every command needs a coding agent working inside a git repository on a machine with Node 18+,
such as Claude Code or Codex. Before any command, run `git rev-parse --show-toplevel`. If it fails,
or there is no shell to run it in (a chat on claude.ai, for example), do nothing else and tell the
person, in one or two sentences: im-a-pm reads the code and its git history, so it runs in a coding
agent opened inside the repository, such as Claude Code, and they can install it there from the
same plugin.

Everything lives in `.im-a-pm/` at the repository root:

| File | What it is | Commit it? |
|---|---|---|
| `.im-a-pm/flows.json` | The map, including `app.commit`, the commit it describes | **Yes** |
| `.im-a-pm/index.html` | The rendered viewer (also served locally) | No |
| `.im-a-pm/sync.json` | Report of the last `sync` | No |
| `.im-a-pm/base.json` | Map of the base ref, used by `diff` | No |
| `.im-a-pm/view.json`, `server.json`, `server.log` | State of the local viewer server | No |

On the first build, add `.im-a-pm/*` and `!.im-a-pm/flows.json` to `.gitignore`.

## The command-line helper

The helper ships with this skill: `scripts/im-a-pm.mjs`, next to this file. It needs Node 18+
and has no dependencies. Run it from the repository root. In the commands below, `<skill-dir>` is
the directory that contains this SKILL.md:

```
node <skill-dir>/scripts/im-a-pm.mjs validate
node <skill-dir>/scripts/im-a-pm.mjs render [--base .im-a-pm/base.json]    # writes index.html and opens it
node <skill-dir>/scripts/im-a-pm.mjs view                                  # opens the current map
node <skill-dir>/scripts/im-a-pm.mjs sync [--since <commit>]               # see /im-a-pm sync
node <skill-dir>/scripts/im-a-pm.mjs stamp
node <skill-dir>/scripts/im-a-pm.mjs trace <flow-id> [<outcome-id>] [--follow]
node <skill-dir>/scripts/im-a-pm.mjs diff <base.json> <head.json>
node <skill-dir>/scripts/im-a-pm.mjs stop                                  # stops the viewer server
```

**The viewer opens itself.** `render`, `view` and `sync` serve the map at
`http://127.0.0.1:4178` (or the next free port) from a background server, and open the browser.
If a tab already shows the map, it reloads itself instead. Always end `build`, `sync`, `change`
and `diff` with a `render`, so the person sees the result. Then tell them the URL the command
printed. Where no browser can be opened (a remote machine, CI), the command says so; pass the URL
on. Use `--no-open` only when the person asks for it.

Read `reference/schema.md` before writing or editing `flows.json`. Read
`reference/entrypoints.md` when building, and when `sync` reports possible new entrypoints.

**The map always describes committed code.** `app.commit` is the commit the map was checked
against, and `sync` reads `git diff <app.commit> HEAD`. So commit code before mapping it, and run
`stamp` only when the map matches HEAD.

---

## /im-a-pm build

Goal: a correct, complete, PM-readable `.im-a-pm/flows.json` for HEAD.

1. **Start clean.** If code has uncommitted changes, ask the person to commit them first, or map
   HEAD and say so. If `.im-a-pm/flows.json` exists, read it and prefer `/im-a-pm sync`, unless
   they want a full rebuild. On a rebuild, keep every flow id and node id that still describes the
   same thing, so diffs across branches stay meaningful.
2. **Inventory entrypoints.** Use `reference/entrypoints.md` to find all of them:
   - HTTP routes and GraphQL resolvers
   - message and event consumers
   - scheduled jobs and queue workers
   - CLI commands
   - saga steps and webhooks
   - on a frontend: the screens and the actions people take on them (submitting a form, pressing
     a button, following a deep link)

   In a monorepo, inventory every app and give each flow a `surface` (`web`, `mobile`, `api`…).
   For frontends, read "Frontends" and "Monorepos" in `reference/entrypoints.md`. They say what
   counts as a rule on a screen, and how a screen's API call links to the API flow
   (`emits: http:POST /orders`).

   Resolve declarative wiring: annotations and decorators, DI containers, route files, framework
   conventions, lazy-loaded modules and config-driven registration. Write the inventory down before
   tracing, then check it against the router or registry so nothing is missed. Skip health checks,
   metrics and docs endpoints, and list them in `excluded`.
3. **Trace each entrypoint to every outcome.** Follow the real call chain through handlers,
   services, domain objects, repositories and queries. Include validation annotations, database
   query filters, exception-to-response mapping, and defaults set in constructors or columns. A
   condition hidden in SQL (`status != 'ARCHIVED'`) or in an annotation (`@Min(1878)`) is a
   business rule like any other.
4. **Keep business decisions, drop technical ones.** Keep a decision when a PM could reasonably
   want it different: eligibility, state and status rules, permissions, limits, required data,
   pricing, defaults, visibility, what gets counted. Drop null-guards, logging and mapping. Map
   retries only when they change what the user or the business sees. A failure path is a
   technical detail, except when it leaves the customer or the business in a bad state (charged
   but no order, a job that silently gives up). Keep those as `implicit` paths (step 9).
5. **Write for a PM.** Phrase decisions as yes/no questions in domain words ("Is the video still a
   draft?"). Phrase actions as verbs ("Count one view"). Put the exact rule in `rule`, in plain
   language with real values. Never use class or method names in `label` or `rule`.

   Give each actor, outside system and data entity one name, and use it in every flow. Before
   writing a new one, look for a name already in the map that means the same thing ("Visitor"
   and "Anyone (no sign-in)" are one actor). An external step talks to one system: when the code
   picks between several, name the role they share ("Payment provider") or split the step.
6. **Record the function order of every step** in `calls`. List each function that runs between
   entering the node and leaving it, in execution order, with `depth` for nesting (the entry
   controller or handler is depth 0). Give each one `file`, `line` and `endLine`: the whole
   function, or just the lines of the branch when one function holds several decisions.

   Include what the framework runs on your behalf, with a `kind`:
   - `framework`: routing, exception handlers, interceptors, guards, DI-resolved implementations, ORM saves
   - `validation`: bean or DTO validation, pipes
   - `query`: SQL or ORM query filters
   - `config`: settings that change behavior
   - `event`: messages published

   The start node holds the routing step, and outcomes hold the response or error mapping. List
   only code in the repository; a library call is listed at the line that calls it. `sync` is only
   as precise as these ranges.
7. **Anchor and grade every node.** Every non-start node gets `anchors` (the file and line where
   the rule lives) and a `confidence`:
   - `high` if you read it directly in the code
   - `medium` if you inferred it across indirection
   - `low` if you guessed

   Never invent behavior you could not see. Use `low` and say why.
8. **Link asynchronous hand-offs.** Split a flow where work continues asynchronously: queues,
   domain events, sagas, scheduled jobs, commands dispatched by a saga. Put `emits` on the step
   that hands off, and `trigger.channel` on the flow that picks it up (see "Hand-offs" in
   `reference/schema.md`). Every emitted channel must start a flow, so a PM can click from
   checkout through to confirmation.
9. **Show how the flow runs.** These are covered in "Loops, parallel work, and paths the code
   does not handle" in `reference/schema.md`:
   - Mark repetition (retries, paging, batches) with a `loop` edge back to where it restarts.
   - Mark split work with `fanout` and the step that waits for it with `join`.
   - Mark every real case the code does not handle with `implicit`: uncaught errors, missing
     defaults, failures after a side effect. Don't skip these. They are often what a PM most
     needs to see.
10. **Mark the happy path** and name every other outcome in `outcomes`. These names become the
   alternate paths in the viewer.
11. **Record findings** a PM would be surprised by: gaps (a state there is no way out of), rules
    that contradict docs or comments, open TODOs, asymmetries between similar flows.
12. **Validate, stamp, render.** Run `validate` and fix every error and every warning. If a
    warning cannot be fixed, tell the person which one and why. Then run `stamp`, which
    records HEAD in `app.commit`, and then `render`, which opens the viewer. Tell the person how
    many flows and decisions you mapped, list the findings, give the viewer URL, and suggest
    committing `.im-a-pm/flows.json`.

## /im-a-pm sync

Goal: bring the map from `app.commit` up to HEAD by re-checking only what changed.

1. **Run `sync`.** The script diffs `app.commit..HEAD` (excluding `.im-a-pm/`) and then:
   - moves every `line`/`endLine` in the map to where that code is now, and follows renamed files
   - marks each step whose `calls` or `anchors` overlap a changed block (or a deleted file) as
     `stale`, with the reasons
   - lists added lines that look like entrypoints, and changed files the map never references
   - records HEAD in `app.commit`, writes `.im-a-pm/sync.json`, and opens the viewer, where stale
     steps show a "re-check" badge

   The line shifts and the stamp happen immediately, so never run `sync` twice to "retry". The
   `stale` marks are the work left to do. If the script says the commit is missing (a shallow
   clone), fetch more history or rebuild. If it reports uncommitted changes, tell the person they
   are not part of this sync.
2. **Re-check every stale step** against the new code. Update `label`, `rule`, `calls`,
   `anchors`, edges and outcomes as needed, keeping ids when the business meaning is the same,
   and reusing the actor, system and entity names already in the map.
   Then delete `stale`. If the change split or merged decisions, restructure the flow, and give new
   ids only to new concepts. Check the flow's other steps when the change could reroute it (a new
   early return, a new exception).
3. **Look at every candidate entrypoint and unmapped file.** Map new entrypoints as new flows
   (build steps 3 to 11). For unmapped files, decide whether they add a rule, wiring (a DI
   binding, middleware, config) or a call into a mapped flow. Tests and pure docs usually need
   nothing. If a mapped entrypoint was removed, remove its flow.
4. **Refresh findings.** Remove the ones the change resolved, and add new ones.
5. **Validate and render.** `validate` must show no errors and no warnings, stale ones
   included. Then `render` with
   `--base` set to the map as it was before the sync: `git show HEAD:.im-a-pm/flows.json >
   .im-a-pm/base.json`, if the map was committed. The open tab reloads with the changes
   highlighted. Summarize the behavioral diff and suggest committing `flows.json`.

## /im-a-pm view

Run `view`. It renders the current map and opens it. In the viewer, "Ask", "Request a change" and
"Flag as wrong" copy a ready-to-paste `/im-a-pm ask` or `/im-a-pm change` command. The person
pastes it in their agent, and you handle it like any other command. A "Flag as wrong" arrives as
`/im-a-pm ask "Check <flow>/<node>. A PM thinks this is wrong: …"`: re-check that step against
the code, then either fix the map or explain why it is right.

## /im-a-pm ask "<question>"

Answer from the map first, then confirm against the code. Use `trace <flow> [<outcome>] [--follow]`
to get the ordered functions of the path in question, including the flows it hands off to, and
read them. Never answer from the map alone. Answer in product language, and name the flows and
nodes involved (`publish-video/is-draft`). Say when the code and the map disagree, and if they do,
fix the map.

## /im-a-pm change <flow>[/<node>] "<request>"

A PM asks for a business change. The output is a branch for engineering review, never a direct
push.

1. Restate the change as **current rule → new rule**. Use the node's `calls` to find the code,
   and list every flow whose `calls` share those functions (the impact). If the request is
   ambiguous, ask one question before editing.
2. Create a branch `im-a-pm/<short-slug>` from the current branch.
3. Make the smallest code change that implements the new rule, and add or update tests. Run the
   project's tests if they can run here, and report the results honestly.
4. Commit the code and the tests.
5. Update `.im-a-pm/flows.json` for the new behavior: the same ids where the meaning is
   unchanged, with updated `calls` and line numbers. Run `validate` and `stamp`, then commit the
   map as a separate commit, so that `app.commit` points at the code it describes.
6. Do not push unless the person asks. Show the behavioral diff against the original branch
   (`/im-a-pm diff <original-branch>`), which renders and opens the viewer.

## /im-a-pm diff [<base-ref>]

Show what business behavior changed between `<base-ref>` (by default, the repo's default branch)
and the current map.

1. Get the base map: `git show <base-ref>:.im-a-pm/flows.json > .im-a-pm/base.json`. If the base
   has no committed map, build one for it in a temporary worktree (`git worktree add <tmp>
   <base-ref>`), reusing ids from the current map, then remove the worktree.
2. Make sure the current map is in sync (`/im-a-pm sync` if `app.commit` is behind HEAD).
3. Run `diff .im-a-pm/base.json .im-a-pm/flows.json`, then `render --base .im-a-pm/base.json`.
   This opens the viewer with the changes highlighted.
4. Summarize for a PM:
   - flows added or removed
   - decisions added or removed
   - rules whose wording changed, with the before → after sentence for each

   Mention "code path changed, same business rule" lines separately, for reviewers.
