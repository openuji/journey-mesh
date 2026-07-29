import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  keyboardTextEntryInputModalityId,
  type JourneyPlan,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import {
  deleteFileIfExists,
  deleteOcsResource,
  ensureFileExists,
  isFixtureShare,
  listOcsShares,
  nextcloudFetch,
  ocsUrl,
  openNextcloudRoute,
  pollUntil,
  requiredEnv,
  staticTransitionValue,
  davFileUrl,
  type NextcloudDriverOptions,
  type NextcloudTouchpointConfig,
  type NextcloudUserConfig,
  type OcsShare
} from "@openuji/journey-driver-nextcloud";

loadExampleEnv();

const fixtureFileName = "report.pdf";
const fixtureFilePath = `/${fixtureFileName}`;
const fixtureUrl = new URL("./deployment/fixtures/report.pdf", import.meta.url);

const aliceTouchpoint: NextcloudTouchpointConfig = {
  baseURL: requiredEnv(process.env, "NEXTCLOUD_ALICE_URL")
};
const bobTouchpoint: NextcloudTouchpointConfig = {
  baseURL: requiredEnv(process.env, "NEXTCLOUD_BOB_URL")
};
const aliceUser: NextcloudUserConfig = {
  label: "Alice",
  username: requiredEnv(process.env, "NEXTCLOUD_ALICE_USER"),
  password: requiredEnv(process.env, "NEXTCLOUD_ALICE_PASSWORD")
};
const bobUser: NextcloudUserConfig = {
  label: "Bob",
  username: requiredEnv(process.env, "NEXTCLOUD_BOB_USER"),
  password: requiredEnv(process.env, "NEXTCLOUD_BOB_PASSWORD")
};

const federatedRecipient =
  process.env.NEXTCLOUD_FEDERATED_RECIPIENT ??
  `${bobUser.username}@${String(bobTouchpoint.baseURL)}`;

export const nextcloudEnvironment: NextcloudDriverOptions = {
  touchpoints: {
    "urn:touchpoint:nextcloud-a": aliceTouchpoint,
    "urn:touchpoint:nextcloud-b": bobTouchpoint
  },
  users: {
    "urn:user:alice": aliceUser,
    "urn:user:bob": bobUser
  },
  entries: {
    "nextcloud.files": openNextcloudRoute("/apps/files/"),
    "nextcloud.pendingShares": openNextcloudRoute("/apps/files/pendingshares")
  },
  transitionValues: {
    "urn:transition:alice-enters-remote-bob": staticTransitionValue(federatedRecipient)
  },
  effectHandlers: {
    "urn:effect:alice-confirm-share": expectAliceOutgoingFederatedShareExists,
    "urn:effect:bob-accept-share": expectAcceptedFederatedShareHasMountedFile
  },
  setupExecution: ensureFederatedShareFixtureIsClean,
  teardownExecution: async () => {
    if (process.env.NEXTCLOUD_PRESERVE_FIXTURES === "1") return;
    await deleteIncomingRemoteShares(bobTouchpoint, bobUser);
    await deleteFileIfExists(bobTouchpoint, bobUser, fixtureFileName);
    await deleteOutgoingSharesForPath(aliceTouchpoint, aliceUser, fixtureFilePath);
  }
};

export function validateNextcloudEnvironmentForPlan(
  plan: JourneyPlan,
  environment: NextcloudDriverOptions = nextcloudEnvironment
): string[] {
  const errors: string[] = [];

  for (const operation of plan.operations) {
    if (!environment.users[operation.actorId]) {
      errors.push(`${operation.id}: missing user config for ${operation.actorId}`);
    }
    if (!environment.touchpoints[operation.touchpointId]) {
      errors.push(`${operation.id}: missing touchpoint config for ${operation.touchpointId}`);
    }
    if (operation.entryBinding && !environment.entries[operation.entryBinding.value]) {
      errors.push(
        `${operation.id}: missing entry handler for ${operation.entryBinding.value}`
      );
    }

    if (operation.kind === "transition") {
      if (requiresTextEntry(operation) && !environment.transitionValues?.[operation.transition.id]) {
        errors.push(`${operation.id}: missing transition value for ${operation.transition.id}`);
      }

      for (const effect of operation.effects) {
        if (!environment.effectHandlers?.[effect.id]) {
          errors.push(`${operation.id}: missing effect handler for ${effect.id}`);
        }
      }
    }
  }

  return [...new Set(errors)];
}

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
            `${endpoint.replace(/\/pending$/, "")}/${encodeURIComponent(String(share.id))}`,
            true
          )
        )
    );
  }
}

function requiresTextEntry(operation: TransitionPlanOperation): boolean {
  return operation.activation.requiredInputModalityProfiles.some((profile) =>
    profile.modalities.some((modality) => modality.id === keyboardTextEntryInputModalityId)
  );
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
      timeoutMs: 30_000
    }
  );
}

async function ocsDataArray(response: Response): Promise<OcsShare[]> {
  const payload = (await response.json()) as { ocs?: { data?: unknown } };
  return Array.isArray(payload.ocs?.data) ? (payload.ocs.data as OcsShare[]) : [];
}

function loadExampleEnv(): void {
  const envUrl = new URL("./deployment/.env", import.meta.url);
  const exampleUrl = new URL("./deployment/.env.example", import.meta.url);
  const envPath = existsSync(fileURLToPath(envUrl)) ? envUrl : exampleUrl;
  const source = readFileSync(envPath, "utf8");

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    process.env[key] ??= value;
  }
}
