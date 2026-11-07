# im-a-pm

**See your codebase the way a product manager does.** im-a-pm turns a repository into a map of
its business flows. Every API route, screen, queue worker, event handler, saga and cron job
becomes a flowchart that runs from the trigger, through the business decisions, to what the user
gets back. You can ask questions about it, request a change to a business rule from it, and see
which business rules a branch changes.

Every step in the map keeps a link to the lines it came from, a confidence grade, and the
functions that run for it, so engineers can check it. The map is one JSON file,
`.im-a-pm/flows.json`, that you commit with your code. When the code changes, `sync` re-checks
only the steps whose code changed.

## Where it runs

im-a-pm reads your code and its git history, so it needs:

- Claude Code, or another coding agent, opened inside a git repository
- Node 18 or later

In a chat on claude.ai, where there is no repository, the skill says so and does nothing else.

## Commands

| Command | What happens |
| --- | --- |
| `/im-a-pm build` | Finds every entrypoint, traces each one to every outcome, writes the map and opens it. |
| `/im-a-pm sync` | Updates the map to the latest commit and re-checks only the steps whose code changed. |
| `/im-a-pm view` | Opens the current map. |
| `/im-a-pm ask "<question>"` | Answers in product language, checked against the code. |
| `/im-a-pm change <flow>[/<step>] "<request>"` | Changes a business rule on a new `im-a-pm/<slug>` branch, with tests and an updated map. Nothing is pushed. |
| `/im-a-pm diff [<base-ref>]` | Shows which business rules changed compared with another branch. |

`/imapm` is a shorter alias for every command.

## What it runs, and what leaves your machine

| What | Where | Leaves your machine? |
| --- | --- | --- |
| Reads the repository with `git` (`rev-parse`, `diff`, `show`). `diff` adds a temporary worktree and removes it. | Your repository | No |
| Writes `.im-a-pm/` at the repository root. On the first build, adds `.im-a-pm/*` and `!.im-a-pm/flows.json` to `.gitignore`. | Your repository | No |
| `change` creates an `im-a-pm/<slug>` branch and commits the code, the tests and the map to it. It never pushes. | Your repository | No |
| Starts a Node server in the background that serves the map at `http://127.0.0.1:4178`, or the next free port. It listens on `127.0.0.1` only and keeps running after the session until it is stopped with `im-a-pm stop`. | Your machine | No |
| Opens the map in your default browser, with `open` on macOS, `xdg-open` on Linux, or `cmd /c start` on Windows and WSL. Set `IM_A_PM_NO_OPEN=1` to turn this off. | Your machine | No |
| The map page loads its fonts from Google Fonts (`fonts.googleapis.com` and `fonts.gstatic.com`). Google receives the request, with your IP address and browser details. Nothing from the map is sent. | Google Fonts | Yes |
| **Star** and **Report** in the map page open this project on GitHub. | GitHub | Only when you click them |
| When the map page is published as a Claude artifact, **Ask** sends the map and your question to Claude, using your own Claude usage. No im-a-pm command publishes an artifact. | Claude | Only in an artifact, when you ask |

Nothing else is sent anywhere. The only thing that reads your code is the coding agent you
already use.

## More

The full documentation, examples and screenshots are at
[github.com/danilojpferreira/im-a-pm](https://github.com/danilojpferreira/im-a-pm). Issues are
welcome there.

MIT license.
