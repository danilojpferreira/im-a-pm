# Example: shop

A small order system written to show the parts of a map that a plain REST API doesn't have. It
is a two-app monorepo: a React checkout in `web/` and the API in `src/`.

| Flow | Shows |
|---|---|
| **Open the checkout** (web, `/checkout`) | A **page** flow: a route guard, an empty cart, and a free-shipping banner that promises free shipping from $99, while the API gives it from $100 (an **inconsistency** finding on both sides) |
| **Pay for the order** (web, Pay button) | A **user action** that calls `POST /orders` and **continues in** "Place an order". What the screen shows for each answer, and a failed request that leaves the button disabled for good |
| **Place an order** (`POST /orders`) | A payment **retry loop** (3 attempts with waits), and two **paths the code doesn't handle**: an inventory timeout, and a card charged before the order fails to save |
| **Ship a paid order** (queue worker) | A **parallel split** (one shipment per warehouse, all at once), a **join** that waits for all of them, and the queue's whole-job retries |
| **Invoice the day's orders** (cron, 02:00) | **Batches** of 100 in a **loop**, with the invoices of each batch issued **in parallel** |

`base.json` is the map of the previous version ("v1"), which had flat $7.90 shipping, no
free-shipping banner and no nightly invoicing. `change-v1-to-now.diff` is the code change between v1 and now. Open
`index.html` with **Show changes** on to see what that change did to the business rules.

The code in `src/` and `web/` is complete enough to be read and mapped, but it is not a runnable app: the
services in `src/lib/services.js` are stubs, and no dependencies are installed. Unlike
`examples/video-api`, which came from mapping a real repository, this map was written by hand
for the examples. `make-map.mjs` writes it, looking up every line number in `src/` and `web/`, so the line
references are real. Run `node examples/shop/make-map.mjs` after changing the code.
