# HTTP fixtures and effect verification

Select `@openuji/journey-environment-http/plugin` under `tests.<id>.environment`.
It implements the existing environment lifecycle; it does not define or execute
journey behavior in place of UJG.

Options:

- `clients`: named `{baseURL, headers?, auth?: {username, password}}` definitions.
- `setup`: ordered fixture requests, each optionally registering `cleanup` requests.
- `effects`: UJG effect ID to ordered **GET/HEAD verification requests**.
- `timeoutMs` (30000) and `cleanupTimeoutMs` (30000).

Each request has `id`, `client`, `path`, optional `method` (GET), `status`
(number or array, default 200), `query`, `headers`, and `json` body. Paths are
relative to the configured origin. Redirects are not followed implicitly.

`capture: {name: "/json/pointer"}` captures response values. `{{name}}` references
are scoped to one profile execution; a whole JSON value preserves its native
type, path substitutions are percent-encoded, and query values use URLSearchParams.
Host `${ENV}` expansion and runtime captures are separate mechanisms.

Assertions use `pointer` plus exactly one of `equals`, `length`, `includes`, or
`excludes`. Inclusion/exclusion match an array element recursively against an
object subset. Explicit JSON assertions can check protocol envelopes such as OCS;
the generic plugin contains no Nextcloud-specific response interpretation.

Read requests may use `poll: {timeoutMs: 30000, intervalMs: 250}`. Mutating requests
are never retried. Successful fixture creation registers its cleanup before
response assertions run; completed fixture groups clean up in reverse order, even
after setup failure or execution cancellation. A group's cleanup requests retain
their listed order, allowing trash followed by permanent deletion.

Every declared UJG effect must have checks, and every configured effect must
exist in the compiled plan. Effect checks cannot mutate the application or register
cleanup. A tested API mutation needs its own modeled transition and a compatible
execution adapter. Setup/cleanup mutations are fixture lifecycle only.

`http/<execution>.json` records step IDs, stage, HTTP status, and outcome. It omits
request URLs, bodies, credentials, captured values, and raw response bodies.
