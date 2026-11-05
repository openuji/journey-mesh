export type Awaitable<T> = T | Promise<T>;

export type NextcloudTouchpointConfig = {
  baseURL: string | URL;
  signal?: AbortSignal;
};

export type NextcloudUserConfig = {
  username: string;
  password: string;
  label?: string;
};

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
    signal: init.signal ?? touchpoint.signal ?? AbortSignal.timeout(30_000),
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
  options: { message: string; timeoutMs: number; intervalMs?: number; signal?: AbortSignal }
): Promise<void> {
  const startedAt = Date.now();
  let lastValue = "not-run";

  while (Date.now() - startedAt <= options.timeoutMs) {
    options.signal?.throwIfAborted();
    lastValue = await check();
    options.signal?.throwIfAborted();
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

async function ocsDataArray(response: Response): Promise<OcsShare[]> {
  const payload = (await response.json()) as { ocs?: { data?: unknown } };
  return Array.isArray(payload.ocs?.data) ? (payload.ocs.data as OcsShare[]) : [];
}

