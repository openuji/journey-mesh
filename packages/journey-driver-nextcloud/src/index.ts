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

import { normalizedBaseURL } from "./service.js";
import type { Awaitable, NextcloudTouchpointConfig, NextcloudUserConfig } from "./service.js";
export * from "./service.js";

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
  decision?: InputModalityDecision;
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
  /** Prefer runner environment.verifyEffect for shared service checks. */
  effectHandlers?: Record<string, NextcloudEffectHandler>;
  /** Prefer runner environment.setup for fixtures shared across runtimes. */
  setupExecution?: (context: NextcloudDriverContext) => Awaitable<void>;
  /** Prefer runner environment.teardown for fixtures shared across runtimes. */
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
    decision?: InputModalityDecision
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

export function staticTransitionValue(value: string): NextcloudTransitionValueProvider {
  return () => value;
}

export function controlFlowTransitionId(operation: ControlFlowPlanOperation): string {
  return operation.transition.id;
}
