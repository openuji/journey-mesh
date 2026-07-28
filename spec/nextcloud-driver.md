````ts
nextcloudDriver({
  touchpoints: {
    "urn:touchpoint:nextcloud-a": {
      baseURL: process.env.NEXTCLOUD_A_URL,
    },
    "urn:touchpoint:nextcloud-b": {
      baseURL: process.env.NEXTCLOUD_B_URL,
    },
  },

  users: {
    "urn:user:alice": {
      username: process.env.ALICE_USERNAME,
      password: process.env.ALICE_PASSWORD,
    },
    "urn:user:bob": {
      username: process.env.BOB_USERNAME,
      password: process.env.BOB_PASSWORD,
    },
  },

  entries: {
    "nextcloud.files": openFilesApplication,
    "nextcloud.pendingShares": openPendingShares,
  },

  featureResolvers: {
    "file-id": resolveFixtureFileId,
    "federated-cloud-id": resolveFederatedCloudId,
  },
});
```

The driver should therefore support lifecycle operations similar to:

````ts
interface JourneyDriver {
  setupExecution(context: ExecutionContext): Promise<void>;
  openEntry(binding: EntryBinding, context: ActorContext): Promise<void>;
  resolveFeature(feature: AccessibleFeature): Promise<unknown>;
  awaitApplicationSettled(context: ActorContext): Promise<void>;
  teardownExecution(context: ExecutionContext): Promise<void>;
}
````