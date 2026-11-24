import { contract, type SourceIdentity } from "@openuji/journey-plugin";
export type AppBuild = Readonly<{ image: string; id: string; identity: SourceIdentity }>;
export type ServerBuild = Readonly<{ image: string; identity: SourceIdentity }>;
export type ManagedStack = Readonly<{ project: string; composeFiles: readonly string[]; envFile: string; services: readonly string[] }>;
export const appBuildContract = contract<AppBuild>("@openuji/nextcloud-app-build/v1");
export const serverBuildContract = contract<ServerBuild>("@openuji/nextcloud-server-build/v1");
export const managedStackContract = contract<ManagedStack>("@openuji/nextcloud-stack/v1");
