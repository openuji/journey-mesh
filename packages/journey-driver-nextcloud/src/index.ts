import type { BrowserContext, Page } from "playwright";

import type {
  PlaywrightDriverExecutionContext,
  PlaywrightJourneyDriver
} from "@openuji/journey-adapter-playwright";
import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import { referencesForOperation } from "@openuji/journey-evidence";

export type Awaitable<T> = T | Promise<T>;

export type NextcloudTouchpointConfig = {
  baseURL: string | URL;
};

export type NextcloudUserConfig = {
  username: string;
  password: string;
  label?: string;
};

export type NextcloudActorSession = {
  actorId: string;
  touchpointId: string;
  user: NextcloudUserConfig;
  touchpoint: NextcloudTouchpointConfig;
  browserContext: BrowserContext;
  page: Page;
};

export type NextcloudDriverContext = PlaywrightDriverExecutionContext & {
  getSession(operation: JourneyPlanOperation): Promise<NextcloudActorSession>;
};

export type NextcloudEntryHandlerInput = {
  session: NextcloudActorSession;
  operation: JourneyPlanOperation;
  context: NextcloudDriverContext;
};

export type NextcloudTransitionValueInput = {
  operation: TransitionPlanOperation;
  context: NextcloudDriverContext;
  session: NextcloudActorSession;
};

export type NextcloudEffectHandlerInput = {
  operation: TransitionPlanOperation;
  effectId: string;
  decision: InputModalityDecision;
  context: NextcloudDriverContext;
  session: NextcloudActorSession;
};

export type NextcloudEntryHandler = (input: NextcloudEntryHandlerInput) => Awaitable<void>;
export type NextcloudTransitionValueProvider = (
  input: NextcloudTransitionValueInput
) => Awaitable<string | undefined>;
export type NextcloudEffectHandler = (input: NextcloudEffectHandlerInput) => Awaitable<void>;

export type NextcloudDriverOptions = {
  touchpoints: Record<string, NextcloudTouchpointConfig>;
  users: Record<string, NextcloudUserConfig>;
  entries: Record<string, NextcloudEntryHandler>;
  transitionValues?: Record<string, string | NextcloudTransitionValueProvider>;
  effectHandlers?: Record<string, NextcloudEffectHandler>;
  setupExecution?: (context: NextcloudDriverContext) => Awaitable<void>;
  teardownExecution?: (context: NextcloudDriverContext) => Awaitable<void>;
  login?: (session: NextcloudActorSession) => Awaitable<void>;
  awaitApplicationSettled?: (session: NextcloudActorSession) => Awaitable<void>;
};

type ExecutionState = {
  sessions: Map<string, NextcloudActorSession>;
};

export function nextcloudDriver(options: NextcloudDriverOptions): PlaywrightJourneyDriver {
  validateDriverOptions(options);

  const executions = new Map<string, ExecutionState>();

  const driver: PlaywrightJourneyDriver = {
    name: "@openuji/journey-driver-nextcloud",
    version: "0.1.0",

    async setupExecution(context) {
      const driverContext = contextForExecution(context);
      executions.set(context.executionId, { sessions: new Map() });
      context.evidence.emit({
        type: "nextcloud.execution.setup.started",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true
      });
      await options.setupExecution?.(driverContext);
      context.evidence.emit({
        type: "nextcloud.execution.setup.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true
      });
    },

    async openEntry(operation, context) {
      if (!operation.entryBinding) {
        throw new Error(`Operation ${operation.id} has no entry binding to open`);
      }

      const driverContext = contextForExecution(context);
      const handler = options.entries[operation.entryBinding.value];
      if (!handler) {
        throw new Error(`No Nextcloud entry handler for ${operation.entryBinding.value}`);
      }

      const session = await getSession(operation, driverContext);
      await handler({ session, operation, context: driverContext });
      await (options.awaitApplicationSettled ?? awaitNextcloudApplicationSettled)(session);

      context.evidence.emit({
        type: "nextcloud.entry.opened",
        executionId: context.executionId,
        profileId: context.profile.id,
        operationId: operation.id,
        operationKind: operation.kind,
        ok: true,
        references: referencesForOperation(context.plan, operation),
        data: {
          entryBindingValue: operation.entryBinding.value,
          baseURL: String(session.touchpoint.baseURL)
        }
      });
    },

    pageForOperation(operation, context) {
      return getSession(operation, contextForExecution(context)).then((session) => session.page);
    },

    async transitionValue(input) {
      const driverContext = contextForExecution(input.context);
      const session = await getSession(input.operation, driverContext);
      const provider = options.transitionValues?.[input.operation.transition.id];
      if (typeof provider === "string") return provider;
      if (typeof provider === "function") {
        return provider({
          operation: input.operation,
          context: driverContext,
          session
        });
      }

      return undefined;
    },

    async afterTransition(operation, decision, context) {
      const driverContext = contextForExecution(context);
      const session = await getSession(operation, driverContext);

      for (const effect of operation.effects) {
        const handler = options.effectHandlers?.[effect.id];
        if (handler) {
          await handler({
            operation,
            effectId: effect.id,
            decision,
            context: driverContext,
            session
          });
        }
      }

      await (options.awaitApplicationSettled ?? awaitNextcloudApplicationSettled)(session);
    },

    async recordControlFlow(operation, context) {
      context.evidence.emit({
        type: "nextcloud.control-flow.recorded",
        executionId: context.executionId,
        profileId: context.profile.id,
        operationId: operation.id,
        operationKind: operation.kind,
        ok: true,
        references: referencesForOperation(context.plan, operation),
        data: {
          fromExitRef: operation.transition.fromExitRef ?? null,
          toEntryRef: operation.transition.toEntryRef ?? null
        }
      });
    },

    async teardownExecution(context) {
      const driverContext = contextForExecution(context);
      const state = executions.get(context.executionId);

      try {
        await options.teardownExecution?.(driverContext);
      } finally {
        if (state) {
          await Promise.all([...state.sessions.values()].map((session) => session.browserContext.close()));
          executions.delete(context.executionId);
        }
      }

      context.evidence.emit({
        type: "nextcloud.execution.teardown.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true
      });
    }
  };

  function contextForExecution(context: PlaywrightDriverExecutionContext): NextcloudDriverContext {
    return {
      ...context,
      getSession(operation) {
        return getSession(operation, contextForExecution(context));
      }
    };
  }

  async function getSession(
    operation: JourneyPlanOperation,
    context: NextcloudDriverContext
  ): Promise<NextcloudActorSession> {
    const state = executions.get(context.executionId);
    if (!state) {
      throw new Error(`No Nextcloud execution state for ${context.executionId}`);
    }

    const sessionKey = `${operation.actorId}\u0000${operation.touchpointId}`;
    const existing = state.sessions.get(sessionKey);
    if (existing) return existing;

    const user = options.users[operation.actorId];
    if (!user) throw new Error(`No Nextcloud user config for ${operation.actorId}`);
    const touchpoint = options.touchpoints[operation.touchpointId];
    if (!touchpoint) {
      throw new Error(`No Nextcloud touchpoint config for ${operation.touchpointId}`);
    }

    const browserContext = await context.createBrowserContext({
      operation,
      label: `${operation.actorId}-${operation.touchpointId}`,
      data: {
        actorId: operation.actorId,
        touchpointId: operation.touchpointId
      }
    });
    const page = await browserContext.newPage();
    const session: NextcloudActorSession = {
      actorId: operation.actorId,
      touchpointId: operation.touchpointId,
      user,
      touchpoint,
      browserContext,
      page
    };

    await (options.login ?? logInToNextcloud)(session);
    state.sessions.set(sessionKey, session);

    context.evidence.emit({
      type: "nextcloud.actor.session.created",
      executionId: context.executionId,
      profileId: context.profile.id,
      ok: true,
      references: referencesForOperation(context.plan, operation),
      data: {
        username: user.username,
        baseURL: String(touchpoint.baseURL)
      }
    });

    return session;
  }

  return driver;
}

export function openNextcloudRoute(route: string): NextcloudEntryHandler {
  return async ({ session }) => {
    await session.page.goto(new URL(route, normalizedBaseURL(session.touchpoint)).href, {
      waitUntil: "domcontentloaded"
    });
    await dismissFirstRunDialog(session.page);
    await awaitNextcloudApplicationSettled(session);
  };
}

export async function logInToNextcloud(session: NextcloudActorSession): Promise<void> {
  const page = session.page;
  await page.goto(normalizedBaseURL(session.touchpoint).href, { waitUntil: "domcontentloaded" });

  const userInput = page.locator('input[name="user"], input[name="username"], input#user').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

  await userInput.waitFor({ state: "visible", timeout: 30_000 });
  await userInput.fill(session.user.username);
  await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  await passwordInput.fill(session.user.password);
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  await page.getByRole("link", { name: "Files" }).first().waitFor({
    state: "visible",
    timeout: 30_000
  });
  await dismissFirstRunDialog(page);
}

export async function awaitNextcloudApplicationSettled(
  session: NextcloudActorSession
): Promise<void> {
  await session.page.locator("#app-content, #content, main").first().waitFor({
    state: "visible",
    timeout: 30_000
  });
}

export async function dismissFirstRunDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog").first();
  if (!(await dialog.isVisible().catch(() => false))) return;

  await dialog.getByRole("button", { name: /close/i }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
}

export function normalizedBaseURL(touchpoint: NextcloudTouchpointConfig): URL {
  const url = touchpoint.baseURL instanceof URL
    ? new URL(touchpoint.baseURL.href)
    : new URL(touchpoint.baseURL);
  url.pathname = trimTrailingSlash(url.pathname);
  return url;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function requiredEnv(
  source: NodeJS.ProcessEnv,
  name: string,
  label = name
): string {
  const value = source[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${label}`);
  }

  return value;
}

export type OcsShare = {
  id: string | number;
  accepted?: string | number | boolean;
  file_id?: string | number | null;
  name?: string;
  file_target?: string;
  mimetype?: string | null;
  mountpoint?: string;
  permissions?: string | number | null;
  path?: string;
};

export function nextcloudFetch(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  url: URL,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${user.username}:${user.password}`).toString("base64")}`,
      "OCS-APIRequest": "true",
      ...init.headers
    }
  });
}

export function ocsUrl(
  touchpoint: NextcloudTouchpointConfig,
  endpoint: string,
  params: Record<string, string> = {}
): URL {
  const url = new URL(`/ocs/v2.php${endpoint}`, normalizedBaseURL(touchpoint));
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function davFileUrl(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  fileName: string
): URL {
  return new URL(
    `/remote.php/dav/files/${encodeURIComponent(user.username)}/${encodeURIComponent(fileName)}`,
    normalizedBaseURL(touchpoint)
  );
}

export async function listOcsShares(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<OcsShare[]> {
  const response = await nextcloudFetch(touchpoint, user, ocsUrl(touchpoint, endpoint, params));
  await expectOk(response, `list OCS resource ${endpoint} for ${user.username}`);
  return ocsDataArray(response);
}

export async function deleteOcsResource(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  endpoint: string,
  bestEffort = false
): Promise<void> {
  const response = await nextcloudFetch(touchpoint, user, ocsUrl(touchpoint, endpoint), {
    method: "DELETE"
  });
  if (bestEffort && [404, 405].includes(response.status)) return;
  await expectOk(response, `delete OCS resource ${endpoint} for ${user.username}`);
}

export async function deleteFileIfExists(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  fileName: string
): Promise<void> {
  const response = await nextcloudFetch(touchpoint, user, davFileUrl(touchpoint, user, fileName), {
    method: "DELETE"
  });
  if (response.status !== 404) {
    await expectOk(response, `delete ${fileName} for ${user.username}`);
  }
}

export async function ensureFileExists(
  touchpoint: NextcloudTouchpointConfig,
  user: NextcloudUserConfig,
  fileName: string,
  body: BodyInit
): Promise<void> {
  const head = await nextcloudFetch(touchpoint, user, davFileUrl(touchpoint, user, fileName), {
    method: "HEAD"
  });
  if (head.ok) return;
  if (head.status !== 404) {
    await expectOk(head, `check ${fileName} for ${user.username}`);
  }

  const response = await nextcloudFetch(touchpoint, user, davFileUrl(touchpoint, user, fileName), {
    body,
    method: "PUT"
  });
  await expectOk(response, `upload ${fileName} for ${user.username}`);
}

export async function pollUntil(
  check: () => Awaitable<string>,
  options: { message: string; timeoutMs: number; intervalMs?: number }
): Promise<void> {
  const startedAt = Date.now();
  let lastValue = "not-run";

  while (Date.now() - startedAt <= options.timeoutMs) {
    lastValue = await check();
    if (lastValue === "ok") return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }

  throw new Error(`${options.message}; last value: ${lastValue}`);
}

export async function expectOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${action} failed: ${response.status} ${response.statusText} ${await response.text()}`);
}

export function isFixtureShare(fileName: string): (share: OcsShare) => boolean {
  return (share) =>
    [share.name, share.file_target, share.mountpoint, share.path].some((value) =>
      String(value ?? "").includes(fileName)
    );
}

function validateDriverOptions(options: NextcloudDriverOptions): void {
  if (Object.keys(options.touchpoints).length === 0) {
    throw new Error("nextcloudDriver requires at least one touchpoint");
  }
  if (Object.keys(options.users).length === 0) {
    throw new Error("nextcloudDriver requires at least one user");
  }
  if (Object.keys(options.entries).length === 0) {
    throw new Error("nextcloudDriver requires at least one entry handler");
  }
}

async function ocsDataArray(response: Response): Promise<OcsShare[]> {
  const payload = (await response.json()) as { ocs?: { data?: unknown } };
  return Array.isArray(payload.ocs?.data) ? (payload.ocs.data as OcsShare[]) : [];
}

export function staticTransitionValue(value: string): NextcloudTransitionValueProvider {
  return () => value;
}

export function controlFlowTransitionId(operation: ControlFlowPlanOperation): string {
  return operation.transition.id;
}
