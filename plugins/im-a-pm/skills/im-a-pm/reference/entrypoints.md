# Finding every entrypoint

An entrypoint is anything that starts business behavior from outside the code: a request, a
message, a schedule, a command. Find them in two passes:

1. **Declarative pass.** Search for the framework's registration markers (tables below).
2. **Registry pass.** Find where the framework *collects* them (router, module, container, broker
   config, scheduler config) and check that every registered entry is in your inventory. This catches
   lazy-loaded modules, routes built in loops, and handlers registered from config.

Then **follow the wiring**: from each entrypoint, resolve DI (constructor injection, `@Autowired`,
providers, containers), interface → implementation bindings, decorators and middleware that run
before the handler (auth guards, validation pipes, interceptors), and exception handlers that turn
errors into responses. These are where many business rules hide.

## HTTP / RPC

| Stack | Markers | Registry / wiring to check |
|---|---|---|
| Spring (Java/Kotlin) | `@RestController`, `@Controller`, `@(Get\|Post\|Put\|Patch\|Delete\|Request)Mapping` | Class-level `@RequestMapping` prefixes; `@Valid` + bean validation (`@NotNull`, `@Min`, `@Pattern`) on DTOs; `@ExceptionHandler` / `@ControllerAdvice`; `@PreAuthorize`, `SecurityFilterChain`; `@Query` on repositories |
| NestJS | `@Controller`, `@Get/@Post/...`, `@Resolver`, `@MessagePattern`, `@EventPattern` | `*.module.ts` controllers/providers, `RouterModule`, guards, pipes, `class-validator` decorators on DTOs, CQRS `@CommandHandler` / `@QueryHandler` / `@EventsHandler`, lazy modules (`LazyModuleLoader`) |
| Express / Koa / Fastify / Hono | `app.get(`, `router.post(`, `fastify.route(`, `app.use('/x', router)` | Mount prefixes, middleware order, routers built from arrays or config |
| Next.js / Remix / SvelteKit | `app/**/route.ts`, `pages/api/**`, server actions (`'use server'`), `loader` / `action` exports | File-system routing: the path *is* the route |
| FastAPI / Flask / Django | `@app.get`, `@router.post`, `@bp.route`, `urlpatterns`, DRF `ViewSet` / `@action` | `include_router` prefixes, `Depends(...)` dependencies, Pydantic validators, DRF permissions and serializers |
| Rails | `config/routes.rb` (`resources`, `namespace`, `member`, `collection`) | `before_action` callbacks, model validations and callbacks, `scope`s, Pundit/CanCan policies |
| Laravel | `routes/*.php`, `Route::apiResource` | Form requests, middleware, policies, Eloquent scopes and observers |
| Go | `http.HandleFunc`, `r.Get(` (chi), `e.GET(` (echo), `gin` groups | Router setup in `main`/`server.go`, middleware chains |
| gRPC | `.proto` `service` blocks | Generated server registration (`Register*Server`) |

## GraphQL

Schema files (`*.graphql`, `typeDefs`), code-first decorators (`@Resolver`, `@Query`, `@Mutation`,
`@ResolveField`), resolver maps. **Mutations** are usually flows. Queries are flows only when they
apply business rules (visibility, permissions, computed values). Field resolvers often hide rules.

## Events, messages and queues

| Tech | Markers |
|---|---|
| Kafka | `@KafkaListener`, `consumer.subscribe`, `eachMessage`, `@EventPattern` (Nest) |
| RabbitMQ / AMQP | `@RabbitListener`, `channel.consume`, `@RabbitSubscribe` |
| SQS / SNS / EventBridge | Lambda handlers + `serverless.yml` / SAM / CDK event sources, `@SqsListener` |
| Pub/Sub, NATS, Redis streams | `subscription.on('message'`, `nc.subscribe`, `XREADGROUP` |
| Domain events in-process | `@EventListener`, `@TransactionalEventListener`, `EventEmitter.on`, `@OnEvent`, `ApplicationEvent` |
| Webhooks | Routes named `webhook`/`callback`, signature verification code (Stripe, GitHub, etc.) |

Also record what each flow **publishes** (`publish`, `send`, `emit`, `kafkaTemplate.send`) as an
`external` node, so flows connect into chains.

## Jobs, schedules and workflows

| Tech | Markers |
|---|---|
| Cron / schedulers | `@Scheduled`, `@Cron` (Nest), `node-cron`, `crontab`, k8s `CronJob`, `schedule:` in CI or serverless config, Rails `whenever`, Celery beat |
| Queues / workers | BullMQ `Worker` / `@Processor`, Sidekiq `perform`, Celery `@task` / `@shared_task`, Resque, Hangfire, Spring Batch `Job` |
| Sagas / workflows | Temporal `@WorkflowMethod` / workflow functions, AWS Step Functions definitions, Camunda BPMN, Nest CQRS `@Saga`, MassTransit / NServiceBus sagas |
| CLI | `commander` / `yargs` commands, Rails `rake` tasks, Django `management/commands`, Spring `CommandLineRunner` |

For sagas, map each step as an `action` or `external` node, and compensations as alternate paths.
When the saga reacts to an event or dispatches commands that run on their own, make it its own
flow (`trigger.channel: "event:<Name>"`) and link the hops with `emits` (see "Hand-offs" in
`schema.md`). In NestJS CQRS, a `@Saga()` is an `ofType(Event)` stream that maps to commands:
the saga is a flow started by `event:<Event>`, emitting `command:<Command>`, and the command
handler is the flow started by that command.

## Infra and config that change behavior

Look at env-driven defaults, feature flags (LaunchDarkly, Unleash, `if (flags.x)`), tenant or plan
config, and database defaults (column defaults, triggers, soft-delete filters). A flag check is a
decision node. Name the flag in `rule`.

## Frontends (web and mobile)

On a screen, a flow starts with **what the person does**: opening a page, submitting a form,
pressing a button, following a deep link or a notification. It also starts when the screen acts
by itself (polling, a timer, a websocket message). Map the actions with business behavior, not
every component.

| Stack | Screens and routes | Actions and data |
|---|---|---|
| React Router | `createBrowserRouter`, `<Route path>`, `loader` / `action` | `onSubmit`, `onClick` handlers, `useNavigate` |
| Next.js | `app/**/page.tsx`, `pages/**`, `middleware.ts`, layouts | server actions (`'use server'`), `route.ts` handlers, `redirect()` |
| Remix / SvelteKit / Nuxt | route files, `loader` / `action`, `+page.ts`, `+page.server.ts` | form actions, `load` functions |
| Vue / Nuxt | `vue-router` routes, `beforeEach` guards, `pages/` | component methods, Pinia actions |
| Angular | `RouterModule.forRoot/forChild`, `canActivate` guards, resolvers | component methods, services, NgRx effects |
| React Native / Expo | `Stack.Screen`, `expo-router` `app/`, deep-link config | `onPress`, push-notification handlers |

What runs in between is spread out on a frontend. Follow it through:
- data hooks and stores: React Query / SWR (`useQuery`, `useMutation`), Redux thunks and sagas,
  Zustand, Pinia, NgRx
- state machines (XState), which are often the clearest statement of the rules
- the API client, where the call to the backend happens

**Business decisions on a screen**
- form validation: `zod` / `yup` / `valibot` schemas, `react-hook-form` rules, HTML `required`,
  `min` and `pattern`
- who sees what: roles, plans, paywalls, ownership checks
- feature flags and A/B tests (LaunchDarkly, Unleash, GrowthBook, PostHog)
- route guards and redirects ("not signed in → /login")
- prices, totals and promises computed on the screen (shipping, discounts, "free from $X")
- what the person sees when something fails, is empty, or is offline
- protections such as a disabled button while a payment is in flight

**Not decisions:** layout, styling, animation, loading spinners, analytics calls, and purely
presentational components.

**Outcomes are what the person sees:** a screen, a redirect, a toast or an inline error. Use the
screen's own copy as the label ("Your card was declined"). It is already in the PM's words.

**Calling the API.** When the screen calls an endpoint of an API in the same repository (a
monorepo), the step that calls it emits `http:<METHOD> <path>`. The API flow for that route picks
it up automatically (see "Hand-offs" in `schema.md`). Then branch on what comes back, with one
decision on the response ("Did the API accept the order?") and an outcome per answer. When the
API is not in the repository (a third-party API, Firebase, Supabase), the call is an `external`
step. Declarative backend rules kept in the repository, such as Firebase security rules or
Supabase row-level security policies, are decisions too.

**Rules that exist on both sides.** A screen often repeats a backend rule: validation, limits,
prices. Check both. When they differ ("free shipping from $99" on the screen, from $100 in the
API), record a finding of kind `inconsistency` on both flows.

## Monorepos

Map the whole repository into one `.im-a-pm/flows.json` at its root, so that hand-offs between
apps resolve. Give every flow a `surface`, the app or package it belongs to: `web`, `mobile`,
`admin`, `api`, `worker`. The viewer groups the list by surface, then by domain. To build in
parts, map one surface at a time ("build the map for the web app") and keep the ids of the
others.

## Exclude (list them in `excluded`)

Health/readiness probes, metrics, API docs (Swagger/OpenAPI UI), static asset serving, framework
boilerplate. Admin or internal endpoints are *not* excluded by default. Map them under an
"Internal" domain.
