# `.im-a-pm/flows.json` schema (version 1)

```jsonc
{
  "version": 1,
  "app": {
    "name": "Video API",                       // product name, not the repo slug
    "summary": "One or two sentences on what the product does, for a PM.",
    "repo": "owner/name",                      // optional
    "ref": "main",                             // branch the map was last checked on
    "commit": "043b40f…",                      // full SHA the map describes; set by `stamp` and `sync`
    "generatedAt": "2026-11-07T18:00:00Z",
    "syncedAt": "2026-11-08T09:12:00Z"          // set by `stamp` and `sync`
  },
  "glossary": [                                // domain words used in labels
    { "term": "Draft", "meaning": "A video that was uploaded but not yet published." }
  ],
  "excluded": [                                // entrypoints deliberately left out, and why
    { "entrypoint": "GET /docs", "reason": "API documentation, not product behavior" }
  ],
  "flows": [
    {
      "id": "publish-video",                   // stable kebab-case slug; reuse it on rebuilds
      "title": "Publish a video",              // verb + object, PM wording
      "surface": "api",                        // optional: the app it belongs to (web, mobile, admin, api…); monorepos
      "domain": "Catalog",                     // groups flows in the sidebar
      "actor": "Content editor",               // who triggers it (user role, system, partner); one name per actor across flows
      "trigger": {
        "kind": "http",                        // http | graphql | event | job | cron | cli | webhook | saga | page | ui | other
        "signature": "PATCH /videos/{id}/publish",
        // "channel": "queue:invoice-email",    // async flows only: what starts this flow (see "Hand-offs")
        "anchors": [{ "file": "src/.../VideoController.java", "line": 101 }]
      },
      "summary": "What the flow achieves, in one or two PM sentences.",
      "nodes": [
        { "id": "start", "type": "start", "label": "Editor asks to publish a video" },
        {
          "id": "is-draft",
          "type": "decision",                  // start | decision | action | data | external | outcome
          "label": "Is the video still a draft?",
          "rule": "Only videos in Draft status can be published. Published videos are rejected.",
          "anchors": [{ "file": "src/.../Video.java", "line": 115 }],
          "confidence": "high",                // high | medium | low
          "calls": [                           // functions that run for this step, in execution order
            { "fn": "Video.validatePublish (status check)", "file": "src/.../Video.java", "line": 115, "endLine": 118, "depth": 3 }
          ]
        },
        {
          "id": "save-published",
          "type": "data",
          "label": "Mark the video as Published",
          "data": { "op": "write", "entity": "Video", "fields": ["status"] },
          "anchors": [{ "file": "src/.../VideoService.java", "line": 192 }],
          "confidence": "high"
        },
        {
          "id": "published",
          "type": "outcome",
          "label": "Video is live",
          "result": "success",                 // success | rejected | error
          "response": "200 · the published video",
          "anchors": [{ "file": "src/.../PublishVideoHandler.java", "line": 38 }],
          "confidence": "high"
        }
      ],
      "edges": [
        { "from": "start", "to": "is-draft" },
        { "from": "is-draft", "to": "save-published", "label": "Yes" },
        { "from": "is-draft", "to": "not-draft", "label": "No" }
      ],
      "happyPath": "published",                // id of the outcome the actor wants
      "outcomes": {                            // names of the alternate paths (every non-happy outcome)
        "not-draft": "Video is already published"
      },
      "findings": [
        {
          "kind": "gap",                       // gap | surprise | inconsistency | todo | risk
          "text": "A video uploaded with empty content can never be published: no endpoint can change content.",
          "nodes": ["has-content"]
        }
      ]
    }
  ]
}
```

## Node types

| type | Meaning | Required fields |
|---|---|---|
| `start` | The trigger, phrased as what the actor does | `label` (exactly one per flow; give it the id `start`, so ids stay the same across rebuilds) |
| `decision` | A business question with 2+ answers | `label` (a question), `rule`, outgoing edges with `label` |
| `action` | Something the system does that matters to the business (calculate, count, notify, assign) | `label` |
| `data` | Information saved or read | `label`, `data.op` (`read` / `write` / `delete`), `data.entity` (named the same in every flow) |
| `external` | Talks to something outside the app (payment provider, email, another service, a published event) | `label`, `system` (one system, named the same in every flow) |
| `outcome` | What the actor gets back | `label`, `result`, optional `response` |

Every node except `start` should have `anchors` and `confidence`. Every node except outcomes
should have `calls`. Outcomes may have them too (response building, error mapping). `rule` is optional on
non-decision nodes. Use it when there is a concrete rule ("Views are counted every time, even for
the same viewer").

## `calls`: the function order

```jsonc
"calls": [
  { "fn": "VideoController.publishVideo", "file": "src/.../VideoController.java", "line": 101, "depth": 0,
    "kind": "framework", "note": "PATCH /videos/{id}/publish routed by Spring MVC" },   // start node: routing
  { "fn": "VideoController.publishVideo", "file": "src/.../VideoController.java", "line": 102, "endLine": 106, "depth": 0 },
  { "fn": "PublishVideoHandler.execute",  "file": "src/.../PublishVideoHandler.java", "line": 32, "endLine": 54, "depth": 1 },
  { "fn": "VideoDatabase.findValid", "file": "src/.../VideoDatabase.java", "line": 26, "endLine": 27, "depth": 5,
    "kind": "query", "note": "SQL: status != 'ARCHIVED'" }
]
```

| Field | Meaning |
|---|---|
| `fn` | `Type.method` as an engineer would search for it. Add a suffix in parentheses when one function holds several steps: `Video.validatePublish (status check)` |
| `file`, `line`, `endLine` | Repo-relative path and the line range that belongs to this step: the whole function, or just the branch of it. `sync` marks the step stale when a change overlaps this range |
| `depth` | Call nesting, 0 = entry function. Indent in traces |
| `kind` | `call` (default), `framework` (routing, DI, exception handlers, interceptors, ORM), `validation`, `query`, `config`, `event` |
| `note` | Optional, short. What this call does for the step when it isn't obvious |

The function order of a path is the concatenation of the `calls` of its nodes, from `start` to the
outcome (`im-a-pm.mjs trace <flow> [<outcome>]`). A function shared by several steps or flows (a
lookup, a save) is listed in each. That repetition is what lets `sync` find every affected flow.

## Loops, parallel work, and paths the code does not handle

These three describe *how* a flow runs. The viewer draws each one differently: repeats as a
dashed arrow up the left gutter, parallel work as stacked cards, and unhandled paths as dashed
red outlines.

**Repeats: `"loop": true` on an edge.** Use it for retries, pagination, polling and "next batch".
It is the only kind of cycle allowed. It must point back to an earlier step, the one the
repetition restarts from. Put the condition that ends the loop in a decision ("Any payment
attempts left?", "Any orders left?"), and the wait or limit in that step's `rule`.

```jsonc
{ "from": "wait", "to": "charge", "label": "retry", "loop": true }
```

**Splitting work: `fanout` and `join` on a step.**
- `fanout` goes on the step that splits the work. `mode` is `parallel` (all at once:
  `Promise.all`, goroutines, parallel streams), `each` (one after another over a list) or
  `batch` (in chunks). `over` says what is split, in product words.
- The step(s) right after a `parallel` or `each` split run once per item. Draw them once; the
  viewer stacks them.
- `join` goes on the step that waits for the split work to finish. `mode` is `all`, `any` or
  `first`. Say in its `rule` what happens when one of them fails.

```jsonc
{ "id": "split", "type": "action", "label": "Split the order by warehouse",
  "fanout": { "mode": "parallel", "over": "one shipment per warehouse, all at once" } }
{ "id": "all-accepted", "type": "decision", "label": "Did every warehouse accept?", "join": { "mode": "all" }, … }
```

**Paths the code does not handle: `"implicit": true`** on an edge, and on the outcome it leads to.
Use it when a real case has no code written for it, and something happens by default anyway:
- an exception that nobody catches (a generic 500, a failed job)
- a missing `else` or `default`
- a failure after a side effect, such as charging a card and then failing to save

Say in the outcome's `rule` what happens by default, and add a finding when it matters. These
are often the most valuable lines on the map for a PM.

```jsonc
{ "from": "save-order", "to": "charged-no-order", "label": "Save fails", "implicit": true }
{ "id": "charged-no-order", "type": "outcome", "result": "error", "implicit": true,
  "label": "Card charged, but no order saved", "rule": "Nothing refunds it …" }
```

## Hand-offs between flows (`emits` and `trigger.channel`)

Split flows where execution becomes asynchronous or decoupled: a job put on a queue, a domain
event handled elsewhere, a saga reacting to an event, a scheduled job, a command dispatched by a
saga. The step that hands off lists what it sends in `emits`. The flow that picks it up names
the same string in `trigger.channel`:

```jsonc
// in flow "place-order", step "queue-invoice"
"emits": [{ "channel": "queue:invoice-email", "label": "one job per paid order" }]

// flow "send-invoice"
"trigger": { "kind": "job", "signature": "BullMQ worker invoice-email", "channel": "queue:invoice-email", "anchors": [ … ] }
```

Channels are `<kind>:<name>`, with kind one of `queue`, `event`, `command`, `schedule`, `topic`,
`webhook`, `graphql` or `rpc`, and the name as the code spells it (`event:UserCreatedEvent`,
`command:CreateWalletCommand`, `graphql:Mutation.createOrder`).

**Screens calling the API** use `http:<METHOD> <path>`, for example `http:POST /orders`. An
HTTP flow (`trigger.kind: "http"`) is started by its own route without declaring a channel:
`POST /orders` starts from `http:POST /orders`. Routes are compared with their parameters
normalized, so `/orders/{id}`, `/orders/:id` and `/orders/[id]` match. In the viewer, the API
flow then says "Called from" the screen, and the screen's step "continues in" the API flow.

```jsonc
// web flow "pay-for-order", step "call-api"
"emits": [{ "channel": "http:POST /orders" }]

// api flow "place-order": nothing to add, its trigger is already POST /orders
"trigger": { "kind": "http", "signature": "POST /orders", … }
```

Several flows may start from one channel, and one step may emit several. Commands executed inline by a request (a controller calling the command bus and
awaiting the result) are part of that flow, not a hand-off. Calls to systems outside the
repository (Stripe, email, OpenAI) are `external` nodes, not `emits`, unless that system calls
back into a flow of this app (a webhook), which then has `trigger.kind: "webhook"`.

`validate` warns when a step emits a channel no flow starts from. `trace <flow> --follow`
continues into the flows a path hands off to, and the viewer links both directions.

## `stale`

Written by `sync` on a node (or flow, if its entrypoint moved) whose code changed:
`"stale": { "reasons": ["Metadata.isComplete changed"], "since": "<old commit>" }`. It means
the step must be re-checked against the code. Delete it once the step is checked. `validate`
warns while any remain, and the viewer marks them "re-check".

## Invariants (checked by `im-a-pm.mjs validate`)

**Errors.** The map cannot be used until they are fixed (`render` refuses it):
- `version` is 1, `app.name` is set, and `flows` is not empty. Every flow has `title`,
  `trigger`, `nodes`, `edges` and `happyPath`.
- Ids are unique: flow ids across the file, node ids within a flow. Ids are kebab-case.
- Every node has a known `type` and a `label`. Decisions have a `rule`, outcomes a `result`, and
  data steps a `data.op`.
- Exactly one `start` node per flow. Every edge points to existing nodes.
- Every node is reachable from the start node. Every non-outcome node has at least one outgoing
  edge.
- `outcome` nodes have no outgoing edges. The graph has no cycles except through edges marked
  `"loop": true`, which must point back to an earlier step.
- `calls` entries have `fn`, `file` and `line`, with `endLine >= line`, `depth >= 0` and a known
  `kind`. Channels in `emits` and `trigger.channel` have one of the shapes listed in "Hand-offs".
- `surface`, when present, is a non-empty name.
- `fanout.mode` is `parallel`, `each` or `batch`, with an `over`. `join.mode` is `all`, `any` or
  `first`. `implicit` is `true` or `false`.
- Decisions have 2+ outgoing edges, each with a `label`.
- `happyPath` names an outcome node.

**Warnings.** The map works, but a detail is missing or unknown. Fix them all before stamping:
- A node other than `start` has no `anchors` or no `confidence`, or a node other than an outcome
  has no `calls`.
- A data step has no `data.entity`, or an external step has no `system`.
- An external step's `system` joins several systems with " / " ("PayPal / Stripe").
- One actor, outside system or data entity is written two ways: the names are the same once case,
  punctuation and text in parentheses are ignored ("System" and "System (server start)").
- `trigger.kind`, or the `kind` of a finding, is not one of the values listed above. A finding
  names a node the flow does not have.
- An outcome other than the happy path has no name in `outcomes`.
- A step emits a channel that no flow starts from.
- A step or flow is still `stale`.

## Changing this format

Maps are committed in the repositories that use them, so a change to this format must keep
every existing version 1 map usable:
- A new check is a **warning** while `version` stays 1.
- A check becomes an **error** only with a new `version`, and this file then says how to move a
  map from the old version to the new one.

## Ids and diffs

Diffs match flows by `id` and nodes by `id` within a flow. When the business fields are equal
but the `calls` sequence differs, the node is reported as "code path changed, same business rule". When rebuilding, keep an id if the
node still means the same business thing, even when its wording, rule or location changed (that
shows up as a *changed* node). Give a new id only to new business concepts. Never renumber.
