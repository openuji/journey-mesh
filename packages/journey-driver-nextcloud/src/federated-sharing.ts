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
} from "./service.js";

export type NextcloudFederatedSharingEnvironmentOptions = {
  sharerTouchpoint: NextcloudTouchpointConfig;
  recipientTouchpoint: NextcloudTouchpointConfig;
  sharerUser: NextcloudUserConfig;
  recipientUser: NextcloudUserConfig;
  fixturePath: string;
  fixtureFileName: string;
  effectIds: {
    shareCreated: string;
    shareAccepted: string;
  };
  preserveFixtures?: boolean;
  timeoutMs?: number;
};

/** Owns the Nextcloud OCS/WebDAV lifecycle for a federated file-sharing fixture. */
export function createNextcloudFederatedSharingEnvironment(
  options: NextcloudFederatedSharingEnvironmentOptions
): JourneyEnvironment {
  if (!options.fixtureFileName || /[\\/]/.test(options.fixtureFileName) || [".", ".."].includes(options.fixtureFileName)) {
    throw new Error("fixtureFileName must be a file name without path segments");
  }
  if (options.effectIds.shareCreated === options.effectIds.shareAccepted) {
    throw new Error("Federated sharing effect IDs must be distinct");
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error("timeoutMs must be a positive number");
  }
  const sharerTouchpoint = { ...options.sharerTouchpoint };
  const recipientTouchpoint = { ...options.recipientTouchpoint };
  const { sharerUser, recipientUser, fixtureFileName } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fixtureFilePath = `/${fixtureFileName}`;
  const fixtureUrl = options.fixturePath;
  const effectChecks: Readonly<Record<string, () => Promise<void>>> = Object.freeze({
    [options.effectIds.shareCreated]: expectOutgoingFederatedShareExists,
    [options.effectIds.shareAccepted]: expectAcceptedFederatedShareHasMountedFile
  });

  const environment: JourneyEnvironment = {
    setup: async (context) => {
      sharerTouchpoint.signal = recipientTouchpoint.signal = context.signal;
      await ensureFederatedShareFixtureIsClean();
    },
    verifyEffect: ({ effect, context }) => {
      sharerTouchpoint.signal = recipientTouchpoint.signal = context.signal;
      const verify = effectChecks[effect.id];
      if (!verify) throw new Error(`No Nextcloud effect verifier for ${effect.id}`);
      return verify();
    },
    teardown: async () => {
      if (options.preserveFixtures) return;
      sharerTouchpoint.signal = recipientTouchpoint.signal = AbortSignal.timeout(timeoutMs);
      let failures: readonly unknown[] = Object.freeze([]);
      for (const cleanup of [
        () => deleteIncomingRemoteShares(recipientTouchpoint, recipientUser),
        () => deleteFileIfExists(recipientTouchpoint, recipientUser, fixtureFileName),
        () => deleteOutgoingSharesForPath(sharerTouchpoint, sharerUser, fixtureFilePath)
      ]) { try { await cleanup(); } catch (error) { failures = Object.freeze([...failures, error]); } }
      if (failures.length) throw new AggregateError(failures, `Nextcloud fixture cleanup failed: ${failures.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
    }
  };



  async function ensureFederatedShareFixtureIsClean(): Promise<void> {
    await deleteIncomingRemoteShares(recipientTouchpoint, recipientUser);
    await deleteFileIfExists(recipientTouchpoint, recipientUser, fixtureFileName);
    await deleteOutgoingSharesForPath(sharerTouchpoint, sharerUser, fixtureFilePath);
    await ensureFileExists(
      sharerTouchpoint,
      sharerUser,
      fixtureFileName,
      await readFile(fixtureUrl)
    );
    await expectFederatedShareFixtureIsClean();
  }

  async function expectOutgoingFederatedShareExists(): Promise<void> {
    await pollUntil(
      async () => {
        const shares = await listOcsShares(
          sharerTouchpoint,
          sharerUser,
          "/apps/files_sharing/api/v1/shares",
          { path: fixtureFilePath }
        ).catch((error) => `sharer-outgoing:${String(error)}`);
        if (typeof shares === "string") return shares;

        return shares.some(isFixtureShare(fixtureFileName)) ? "ok" : "sharer-outgoing:missing";
      },
      {
        message: "Outgoing federated share should exist",
        signal: sharerTouchpoint.signal,
        timeoutMs
      }
    );
  }

  async function expectAcceptedFederatedShareHasMountedFile(): Promise<void> {
    await pollUntil(
      async () => {
        const shares = await listOcsShares(
          recipientTouchpoint,
          recipientUser,
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
          recipientTouchpoint,
          recipientUser,
          davFileUrl(recipientTouchpoint, recipientUser, fixtureFileName),
          { method: "HEAD" }
        );
        return response.ok ? "ok" : `webdav:${response.status}`;
      },
      {
        message: `Accepted remote share should be mounted as ${fixtureFileName}`,
        signal: recipientTouchpoint.signal,
        timeoutMs
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
        const sharerShares = await listOcsShares(
          sharerTouchpoint,
          sharerUser,
          "/apps/files_sharing/api/v1/shares",
          { path: fixtureFilePath }
        );
        if (sharerShares.length > 0) return `sharer-outgoing:${sharerShares.length}`;

        const recipientShares = await listOcsShares(
          recipientTouchpoint,
          recipientUser,
          "/apps/files_sharing/api/v1/remote_shares"
        );
        if (recipientShares.some(isFixtureShare(fixtureFileName))) return "recipient-remote-share:present";

        const pendingRecipientShares = await listOcsShares(
          recipientTouchpoint,
          recipientUser,
          "/apps/files_sharing/api/v1/remote_shares/pending"
        );
        if (pendingRecipientShares.some(isFixtureShare(fixtureFileName))) {
          return "recipient-pending-share:present";
        }

        const recipientFile = await nextcloudFetch(
          recipientTouchpoint,
          recipientUser,
          davFileUrl(recipientTouchpoint, recipientUser, fixtureFileName),
          { method: "HEAD" }
        );
        if (recipientFile.ok) return "recipient-file:present";
        if (recipientFile.status !== 404) return `recipient-file:${recipientFile.status}`;

        const sharerFile = await nextcloudFetch(
          sharerTouchpoint,
          sharerUser,
          davFileUrl(sharerTouchpoint, sharerUser, fixtureFileName),
          { method: "HEAD" }
        );
        return sharerFile.ok ? "ok" : `sharer-file:${sharerFile.status}`;
      },
      {
        message: "Federated share fixture should be clean before the journey",
        signal: sharerTouchpoint.signal,
        timeoutMs
      }
    );
  }

  async function ocsDataArray(response: Response): Promise<OcsShare[]> {
    const payload = (await response.json()) as { ocs?: { data?: unknown } };
    return Array.isArray(payload.ocs?.data) ? (payload.ocs.data as OcsShare[]) : [];
  }

  return environment;
}
