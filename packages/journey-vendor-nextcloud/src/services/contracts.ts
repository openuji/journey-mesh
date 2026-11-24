import { composeStackContract, type ComposeStack } from "@openuji/journey-service-docker/compose";
import { contract, type SourceIdentity } from "@openuji/journey-plugin";
export type AppBuild = Readonly<{ image: string; id: string; identity: SourceIdentity }>;
export type ServerBuild = Readonly<{ image: string; identity: SourceIdentity }>;
/** The running stack: the generic Compose stack contract, which other Compose-based vendors share. */
export type ManagedStack = ComposeStack;
export const appBuildContract = contract<AppBuild>("@openuji/nextcloud-app-build/v1");
export const serverBuildContract = contract<ServerBuild>("@openuji/nextcloud-server-build/v1");
export const managedStackContract = composeStackContract;
