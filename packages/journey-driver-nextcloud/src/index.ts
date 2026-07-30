import type { BrowserContext, Page } from "playwright";

import type {
  PlaywrightDriverCloseInput,
  PlaywrightDriverExecutionInput,
  PlaywrightDriverExecutionContext,
  PlaywrightJourneyDriver,
  PlaywrightJourneyDriverExecution
} from "@openuji/journey-adapter-playwright";
import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyProfile,
  TransitionPlanOperation
} from "@openuji/journey-runner";

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

export type NextcloudDriverContext = {
  readonly runId: string;
  readonly executionId: string;
  readonly profileId: string;
  readonly profile: JourneyProfile;
  readonly plan: JourneyPlan;
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

export function nextcloudDriver(options: NextcloudDriverOptions): PlaywrightJourneyDriver {
  validateDriverOptions(options);

  return {
    name: "@openuji/journey-driver-nextcloud",
    version: "0.1.0",

    createExecution(input) {
      return new NextcloudExecution(input, options);
    }
  };
}

class NextcloudExecution implements PlaywrightJourneyDriverExecution {
  private readonly sessions = new Map<string, NextcloudActorSession>();
  private readonly driverContext: PlaywrightDriverExecutionContext;
  private readonly context: NextcloudDriverContext;
  private started = false;
  private closed = false;

  constructor(
    input: PlaywrightDriverExecutionInput,
    private readonly options: NextcloudDriverOptions
  ) {
    this.driverContext = input.context;
    this.context = {
      runId: input.context.runId,
      executionId: input.context.executionId,
      profileId: input.context.profile.id,
      profile: input.context.profile,
      plan: input.context.plan,
      getSession: (operation) => this.getSession(operation)
    };
  }

  async start(): Promise<void> {
    this.assertOpen();
    if (this.started) {
      throw new Error(`Nextcloud execution ${this.context.executionId} has already started`);
    }

    await this.options.setupExecution?.(this.context);
    this.started = true;
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    this.assertOpen();
    if (!operation.entryBinding) {
      throw new Error(`Operation ${operation.id} has no entry binding to open`);
    }

    const handler = this.options.entries[operation.entryBinding.value];
    if (!handler) {
      throw new Error(`No Nextcloud entry handler for ${operation.entryBinding.value}`);
    }

    const session = await this.getSession(operation);
    await handler({ session, operation, context: this.context });
    await (this.options.awaitApplicationSettled ?? awaitNextcloudApplicationSettled)(session);
  }

  async pageForOperation(operation: JourneyPlanOperation): Promise<Page> {
    return (await this.getSession(operation)).page;
  }

  async transitionValue(operation: TransitionPlanOperation): Promise<string | undefined> {
    const session = await this.getSession(operation);
    const provider = this.options.transitionValues?.[operation.transition.id];
    if (typeof provider === "string") return provider;
    if (typeof provider === "function") {
      return provider({
        operation,
        context: this.context,
        session
      });
    }

    return undefined;
  }

  async afterTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void> {
    const session = await this.getSession(operation);

    for (const effect of operation.effects) {
      const handler = this.options.effectHandlers?.[effect.id];
      if (handler) {
        await handler({
          operation,
          effectId: effect.id,
          decision,
          context: this.context,
          session
        });
      }
    }

    await (this.options.awaitApplicationSettled ?? awaitNextcloudApplicationSettled)(session);
  }

  recordControlFlow(operation: ControlFlowPlanOperation): void {
    this.assertOpen();
  }

  async close(_input: PlaywrightDriverCloseInput): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.options.teardownExecution?.(this.context);
    } finally {
      await Promise.all([...this.sessions.values()].map((session) => session.browserContext.close()));
      this.sessions.clear();
    }
  }

  private async getSession(operation: JourneyPlanOperation): Promise<NextcloudActorSession> {
    this.assertOpen();

    const sessionKey = `${operation.actorId}\u0000${operation.touchpointId}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const user = this.options.users[operation.actorId];
    if (!user) throw new Error(`No Nextcloud user config for ${operation.actorId}`);
    const touchpoint = this.options.touchpoints[operation.touchpointId];
    if (!touchpoint) {
      throw new Error(`No Nextcloud touchpoint config for ${operation.touchpointId}`);
    }

    const browserContext = await this.driverContext.createBrowserContext({
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

    await (this.options.login ?? logInToNextcloud)(session);
    this.sessions.set(sessionKey, session);

    return session;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`Nextcloud execution ${this.context.executionId} is closed`);
    }
  }
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
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"], input[type="submit"]').first().click()
  ]);
  await page.locator("#header").first().waitFor({
    state: "visible",
    timeout: 30_000
  });
  await dismissFirstRunDialog(page);
  await awaitNextcloudApplicationSettled(session);
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
