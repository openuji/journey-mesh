import { readFile } from "node:fs/promises";
import type { JourneyEnvironment } from "@openuji/journey-runner";

import {
  deleteFileIfExists,
  deleteOcsResource,
  ensureFileExists,
  isFixtureShare,
  listOcsShares,
  nextcloudFetch,
  ocsUrl,
  pollUntil,
  davFileUrl,
  type NextcloudTouchpointConfig,
  type NextcloudUserConfig,
  type OcsShare
} from "@openuji/journey-driver-nextcloud/service";

export type NextcloudEnvironmentOptions = {
  aliceTouchpoint: NextcloudTouchpointConfig;
  bobTouchpoint: NextcloudTouchpointConfig;
  aliceUser: NextcloudUserConfig;
  bobUser: NextcloudUserConfig;
  fixturePath: string;
  preserveFixtures?: boolean;
};

/** Fixture semantics are application code; all deployment data comes from YAML. */
export function createNextcloudEnvironment(options: NextcloudEnvironmentOptions): JourneyEnvironment {
  const aliceTouchpoint = { ...options.aliceTouchpoint };
  const bobTouchpoint = { ...options.bobTouchpoint };
  const { aliceUser, bobUser } = options;
  const fixtureFileName = "report.pdf";
  const fixtureFilePath = `/${fixtureFileName}`;
  const fixtureUrl = options.fixturePath;
  const effectChecks = new Map<string, () => Promise<void>>([
    ["urn:effect:alice-confirm-share", expectAliceOutgoingFederatedShareExists],
    ["urn:effect:bob-accept-share", expectAcceptedFederatedShareHasMountedFile]
  ]);

  const environment: JourneyEnvironment = {
    setup: async (context) => {
      aliceTouchpoint.signal = bobTouchpoint.signal = context.signal;
      await ensureFederatedShareFixtureIsClean();
    },
    verifyEffect: ({ effect, context }) => {
      aliceTouchpoint.signal = bobTouchpoint.signal = context.signal;
      const verify = effectChecks.get(effect.id);
      if (!verify) throw new Error(`No Nextcloud effect verifier for ${effect.id}`);
      return verify();
    },
    teardown: async () => {
      if (options.preserveFixtures) return;
      aliceTouchpoint.signal = bobTouchpoint.signal = AbortSignal.timeout(30_000);
      const failures: unknown[] = [];
      for (const cleanup of [
        () => deleteIncomingRemoteShares(bobTouchpoint, bobUser),
        () => deleteFileIfExists(bobTouchpoint, bobUser, fixtureFileName),
        () => deleteOutgoingSharesForPath(aliceTouchpoint, aliceUser, fixtureFilePath)
      ]) { try { await cleanup(); } catch (error) { failures.push(error); } }
      if (failures.length) throw new AggregateError(failures, `Nextcloud fixture cleanup failed: ${failures.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
    }
  };



  async function ensureFederatedShareFixtureIsClean(): Promise<void> {
    await deleteIncomingRemoteShares(bobTouchpoint, bobUser);
    await deleteFileIfExists(bobTouchpoint, bobUser, fixtureFileName);
    await deleteOutgoingSharesForPath(aliceTouchpoint, aliceUser, fixtureFilePath);
    await ensureFileExists(
      aliceTouchpoint,
      aliceUser,
      fixtureFileName,
      await readFile(fixtureUrl)
    );
    await expectFederatedShareFixtureIsClean();
  }

  async function expectAliceOutgoingFederatedShareExists(): Promise<void> {
    await pollUntil(
      async () => {
        const shares = await listOcsShares(
          aliceTouchpoint,
          aliceUser,
          "/apps/files_sharing/api/v1/shares",
          { path: fixtureFilePath }
        ).catch((error) => `alice-outgoing:${String(error)}`);
        if (typeof shares === "string") return shares;

        return shares.some(isFixtureShare(fixtureFileName)) ? "ok" : "alice-outgoing:missing";
      },
      {
        message: "Alice outgoing federated share should exist",
        signal: aliceTouchpoint.signal,
        timeoutMs: 30_000
      }
    );
  }

  async function expectAcceptedFederatedShareHasMountedFile(): Promise<void> {
    await pollUntil(
      async () => {
        const shares = await listOcsShares(
          bobTouchpoint,
          bobUser,
          "/apps/files_sharing/api/v1/remote_shares"
        ).catch((error) => `remote-shares:${String(error)}`);
        if (typeof shares === "string") return shares;

        const share = shares.find(isFixtureShare(fixtureFileName));
        if (!share) return "remote-share:missing";
        if (String(share.accepted) !== "1") return `remote-share:accepted:${String(share.accepted)}`;
        if (!share.file_id) return "remote-share:file-id-missing";
        if (!share.mimetype) return "remote-share:mimetype-missing";
        if (share.permissions == null) return "remote-share:permissions-missing";

        const response = await nextcloudFetch(
          bobTouchpoint,
          bobUser,
          davFileUrl(bobTouchpoint, bobUser, fixtureFileName),
          { method: "HEAD" }
        );
        return response.ok ? "ok" : `webdav:${response.status}`;
      },
      {
        message: "Bob accepted remote share should be mounted as report.pdf",
        signal: aliceTouchpoint.signal,
        timeoutMs: 30_000
      }
    );
  }

  async function deleteOutgoingSharesForPath(
    touchpoint: NextcloudTouchpointConfig,
    user: NextcloudUserConfig,
    path: string
  ): Promise<void> {
    const shares = await listOcsShares(touchpoint, user, "/apps/files_sharing/api/v1/shares", {
      path
    });

    await Promise.all(
      shares.map((share) =>
        deleteOcsResource(
          touchpoint,
          user,
          `/apps/files_sharing/api/v1/shares/${encodeURIComponent(String(share.id))}`
        )
      )
    );
  }

  async function deleteIncomingRemoteShares(
    touchpoint: NextcloudTouchpointConfig,
    user: NextcloudUserConfig
  ): Promise<void> {
    const endpoints = [
      "/apps/files_sharing/api/v1/remote_shares",
      "/apps/files_sharing/api/v1/remote_shares/pending"
    ];

    for (const endpoint of endpoints) {
      const response = await nextcloudFetch(touchpoint, user, ocsUrl(touchpoint, endpoint));
      if (!response.ok) continue;
      const shares = await ocsDataArray(response).catch(() => []);
      await Promise.all(
        shares
          .filter(isFixtureShare(fixtureFileName))
          .map((share) =>
            deleteOcsResource(
              touchpoint,
              user,
              `${endpoint}/${encodeURIComponent(String(share.id))}`,
              true
            )
          )
      );
    }
  }


  async function expectFederatedShareFixtureIsClean(): Promise<void> {
    await pollUntil(
      async () => {
        const aliceShares = await listOcsShares(
          aliceTouchpoint,
          aliceUser,
          "/apps/files_sharing/api/v1/shares",
          { path: fixtureFilePath }
        );
        if (aliceShares.length > 0) return `alice-outgoing:${aliceShares.length}`;

        const bobShares = await listOcsShares(
          bobTouchpoint,
          bobUser,
          "/apps/files_sharing/api/v1/remote_shares"
        );
        if (bobShares.some(isFixtureShare(fixtureFileName))) return "bob-remote-share:present";

        const pendingBobShares = await listOcsShares(
          bobTouchpoint,
          bobUser,
          "/apps/files_sharing/api/v1/remote_shares/pending"
        );
        if (pendingBobShares.some(isFixtureShare(fixtureFileName))) {
          return "bob-pending-share:present";
        }

        const bobFile = await nextcloudFetch(
          bobTouchpoint,
          bobUser,
          davFileUrl(bobTouchpoint, bobUser, fixtureFileName),
          { method: "HEAD" }
        );
        if (bobFile.ok) return "bob-file:present";
        if (bobFile.status !== 404) return `bob-file:${bobFile.status}`;

        const aliceFile = await nextcloudFetch(
          aliceTouchpoint,
          aliceUser,
          davFileUrl(aliceTouchpoint, aliceUser, fixtureFileName),
          { method: "HEAD" }
        );
        return aliceFile.ok ? "ok" : `alice-file:${aliceFile.status}`;
      },
      {
        message: "Federated share fixture should be clean before the journey",
        signal: aliceTouchpoint.signal,
        timeoutMs: 30_000
      }
    );
  }

  async function ocsDataArray(response: Response): Promise<OcsShare[]> {
    const payload = (await response.json()) as { ocs?: { data?: unknown } };
    return Array.isArray(payload.ocs?.data) ? (payload.ocs.data as OcsShare[]) : [];
  }

  return environment;
}

import { booleanOption, knownOptions, optionsObject, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyEnvironment> = {
  apiVersion: 1, kind: "environment",
  validate(options) {
    knownOptions(options, ["aliceTouchpoint", "bobTouchpoint", "aliceUser", "bobUser", "fixturePath", "preserveFixtures"]);
    for (const name of ["aliceTouchpoint", "bobTouchpoint"]) {
      try { new URL(requiredString(optionsObject(options[name]).baseURL, `${name}.baseURL`)); }
      catch { throw new Error(`Invalid ${name}.baseURL`); }
    }
    for (const name of ["aliceUser", "bobUser"]) {
      const user = optionsObject(options[name]); requiredString(user.username, `${name}.username`); requiredString(user.password, `${name}.password`);
    }
    requiredString(options.fixturePath, "fixturePath"); booleanOption(options.preserveFixtures);
  },
  create(options, context) {
    return createNextcloudEnvironment({ ...options, fixturePath: context.resolvePath(options.fixturePath as string), preserveFixtures: booleanOption(options.preserveFixtures) } as NextcloudEnvironmentOptions);
  }
};
