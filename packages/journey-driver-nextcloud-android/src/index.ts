import { xpathLiteral, type AppiumDriverExecutionContext, type AppiumJourneyDriver, type AppiumJourneyDriverExecution, type AppiumSession, type AppiumSessionOptions } from "@openuji/journey-adapter-appium";
import { normalizedBaseURL, type NextcloudTouchpointConfig, type NextcloudUserConfig } from "@openuji/journey-driver-nextcloud/service";
import type { JourneyPlanOperation } from "@openuji/journey-runner";

export type NextcloudAndroidActorSession = Readonly<{
  actorId: string; touchpointId: string;
  user: NextcloudUserConfig; touchpoint: NextcloudTouchpointConfig;
  native: AppiumSession;
}>;
export type NextcloudAndroidEntryHandler = (input: Readonly<{
  operation: JourneyPlanOperation; session: NextcloudAndroidActorSession;
}>) => Promise<void> | void;
export type NextcloudAndroidDriverOptions = Readonly<{
  touchpoints: Readonly<Record<string, NextcloudTouchpointConfig>>;
  users: Readonly<Record<string, NextcloudUserConfig>>;
  devices: Readonly<Record<string, AppiumSessionOptions>>;
  entries: Readonly<Record<string, NextcloudAndroidEntryHandler>>;
  login?: (session: NextcloudAndroidActorSession) => Promise<void>;
  awaitApplicationSettled?: (session: NextcloudAndroidActorSession) => Promise<void>;
}>;

export function nextcloudAndroidDriver(options: NextcloudAndroidDriverOptions): AppiumJourneyDriver {
  for (const key of ["touchpoints", "users", "devices", "entries"] as const) {
    if (Object.keys(options[key]).length === 0) throw new Error(`nextcloudAndroidDriver requires ${key}`);
  }
  return { name: "@openuji/journey-driver-nextcloud-android", version: "0.1.0",
    createExecution: ({ context }) => new NextcloudAndroidExecution(context, options) };
}

class NextcloudAndroidExecution implements AppiumJourneyDriverExecution {
  private lifecycle: "created" | "started" | "closed" = "created";
  private readonly sessions = new Map<string, NextcloudAndroidActorSession>();
  constructor(private readonly context: AppiumDriverExecutionContext, private readonly options: NextcloudAndroidDriverOptions) {}
  start(): void {
    if (this.lifecycle !== "created") throw new Error(`Nextcloud Android execution cannot start from ${this.lifecycle}`);
    this.lifecycle = "started";
  }
  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    this.assertStarted();
    const handler = operation.entryBinding && this.options.entries[operation.entryBinding.value];
    if (!handler) throw new Error(`No Nextcloud Android entry handler for ${operation.entryBinding?.value ?? operation.entry.id}`);
    const session = await this.getSession(operation);
    await handler({ session, operation });
    await this.settle(session);
  }
  async sessionForOperation(operation: JourneyPlanOperation): Promise<AppiumSession> {
    return (await this.getSession(operation)).native;
  }
  async afterTransition(operation: Parameters<AppiumJourneyDriverExecution["afterTransition"]>[0]): Promise<void> {
    await this.settle(await this.getSession(operation));
  }
  recordControlFlow(): void { this.assertStarted(); }
  close(): void {
    // Sessions belong to the adapter, which also handles failed login/startup.
    this.sessions.clear();
    this.lifecycle = "closed";
  }
  private async getSession(operation: JourneyPlanOperation): Promise<NextcloudAndroidActorSession> {
    this.assertStarted();
    const key = JSON.stringify([operation.actorId, operation.touchpointId]);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const user = this.options.users[operation.actorId];
    const touchpoint = this.options.touchpoints[operation.touchpointId];
    const device = this.options.devices[operation.touchpointId];
    if (!user || !touchpoint || !device) throw new Error(`Missing Nextcloud Android user, service, or device config for ${operation.actorId} / ${operation.touchpointId}`);
    const udid = device.capabilities["appium:udid"];
    if (typeof udid !== "string" || !udid) throw new Error("Nextcloud Android requires an explicit dedicated device UDID");
    if (typeof device.capabilities["appium:app"] !== "string" || !device.capabilities["appium:app"]) {
      throw new Error("Nextcloud Android requires an APK for a fresh installation per profile");
    }
    if ([...this.sessions.values()].some((session) => this.options.devices[session.touchpointId]?.capabilities["appium:udid"] === udid)) {
      throw new Error(`Device ${udid} cannot isolate another actor/touchpoint concurrently`);
    }
    // Android account records can survive a data-only reset. Reinstall the test
    // APK for each profile so account isolation includes AccountManager state.
    const native = await this.context.createSession({ capabilities: {
      ...device.capabilities, "appium:noReset": false, "appium:fullReset": true
    } });
    const session = Object.freeze({ actorId: operation.actorId, touchpointId: operation.touchpointId, user, touchpoint, native });
    this.sessions.set(key, session);
    await (this.options.login ?? logInToNextcloudAndroid)(session);
    return session;
  }
  private async settle(session: NextcloudAndroidActorSession): Promise<void> {
    await (this.options.awaitApplicationSettled ?? awaitNextcloudAndroidSettled)(session);
  }
  private assertStarted(): void {
    if (this.lifecycle !== "started") throw new Error(`Nextcloud Android execution is not started (${this.lifecycle})`);
  }
}

const app = "com.nextcloud.client";
const resource = (id: string) => `//*[@resource-id=${xpathLiteral(`${app}:id/${id}`)}]`;
const button = (text: string) => `//*[@class='android.widget.Button' and @text=${xpathLiteral(text)}]`;
const chromeClose = "//*[@resource-id='com.android.chrome:id/close_button']";

/** UI account setup is outside the modeled sharing journey and is not audited. */
export async function logInToNextcloudAndroid(session: NextcloudAndroidActorSession): Promise<void> {
  const native = session.native;
  // Account setup uses Chrome custom tabs. Isolate its cookies and first-run UI
  // as well as the native account on the dedicated test device.
  await native.execute("mobile: terminateApp", { appId: "com.android.chrome" });
  await native.execute("mobile: clearApp", { appId: "com.android.chrome" });
  const wait = (queries: readonly string[], label: string, timeoutMs?: number) => waitForNativeChoice(native, queries, label, timeoutMs, true, true);
  const welcome = await wait([resource("login"), resource("host_url_input")], "Nextcloud welcome or server form");
  if (welcome.index === 0) await native.tap(welcome.elementId);
  const host = await wait([resource("host_url_input")], "Nextcloud server address");
  await native.setValue(host.elementId, normalizedBaseURL(session.touchpoint).href);
  const connect = await wait([resource("text_input_end_icon")], "Test server connection");
  await native.tap(connect.elementId);

  const entry = await wait(["//*[@resource-id='user']", button("Grant access"), button("Log in")], "Nextcloud login page");
  if (entry.index === 2) await native.tap(entry.elementId);
  const auth = entry.index === 1 ? entry : await wait(["//*[@resource-id='user']", button("Grant access")], "Account credentials or authorization");
  if (auth.index === 0) {
    await native.setValue(auth.elementId, session.user.username);
    const password = await wait(["//*[@resource-id='password']"], "Account password field");
    await native.setValue(password.elementId, session.user.password);
    const login = await wait([button("Log in")], "Account login action");
    await native.tap(login.elementId);
  }
  const grant = await wait([button("Grant access")], "Account access authorization");
  // Chrome may retain an authenticated cookie between profiles. Check its actor before granting.
  const identity = await native.findElements(`//*[contains(@text, ${xpathLiteral(`(${session.user.username})`)})]`);
  if (identity.length !== 1) throw new Error("Nextcloud authorization page does not identify the configured test account");
  await native.tap(grant.elementId);
  const connected = await wait([resource("menu_button"), "//*[@text='Account connected']"], "Connected native account", 60_000);
  if (connected.index === 1) {
    const close = await wait([chromeClose], "Close completed browser login");
    await native.tap(close.elementId);
  }
  await wait([resource("menu_button")], "Native file screen", 60_000);
}

export async function awaitNextcloudAndroidSettled(session: NextcloudAndroidActorSession): Promise<void> {
  await waitForNativeChoice(session.native, [`//*[@package='${app}' and @displayed='true']`], "Native application surface", 30_000, false);
}

export const openNextcloudAndroidNotifications: NextcloudAndroidEntryHandler = async ({ session }) => {
  // Alice creates the offer before Bob signs in. No push-service dependency is required.
  const notification = await waitForNativeChoice(session.native, [resource("notification_button")], "Native notification entry", 60_000);
  await session.native.tap(notification.elementId);
  await waitForNativeChoice(session.native, ["//*[@class='android.widget.TextView' and @text='Notifications']"], "Notifications screen");
};

/** Bounded UI waits; no service APIs perform modeled native actions. */
async function waitForNativeChoice(native: AppiumSession, queries: readonly string[], label: string, timeoutMs = 60_000, singleton = true, setupPrompts = false): Promise<{ index: number; elementId: string }> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (setupPrompts) await dismissSetupPrompt(native);
    for (const [index, query] of queries.entries()) {
      const elements = await native.findElements(query);
      if (singleton && elements.length > 1) throw new Error(`Ambiguous ${label}: found ${elements.length} controls`);
      if (elements.length) return { index, elementId: elements[0]!.elementId };
    }
    if (Date.now() >= deadline) {
      const source = await native.source().catch(() => "");
      const ids = [...new Set([...source.matchAll(/resource-id="([^"]+)"/g)].map((match) => match[1]))].slice(-15);
      throw new Error(`Timed out waiting for ${label}; visible resource IDs: ${ids.join(", ") || "unavailable"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (true);
}
async function dismissSetupPrompt(native: AppiumSession): Promise<void> {
  const prompt = await native.findElements(`//*[@resource-id='com.android.permissioncontroller:id/permission_allow_button' or @resource-id='com.android.chrome:id/signin_fre_dismiss_button' or @resource-id='com.android.chrome:id/terms_accept' or @resource-id='com.android.chrome:id/ack_button' or @resource-id='com.android.chrome:id/negative_button' or (@package='${app}' and @class='android.widget.Button' and @text=${xpathLiteral("Don't ask")})]`);
  if (prompt.length === 1) await native.tap(prompt[0]!.elementId);
}
