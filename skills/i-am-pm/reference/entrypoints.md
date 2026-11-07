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

## Exclude (list them in `excluded`)

Health/readiness probes, metrics, API docs (Swagger/OpenAPI UI), static asset serving, framework
boilerplate. Admin or internal endpoints are *not* excluded by default. Map them under an
"Internal" domain.
