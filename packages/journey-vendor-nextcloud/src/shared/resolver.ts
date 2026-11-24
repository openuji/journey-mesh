import type {
  ClientBindingOptions, ClientTouchpointBinding, ClientUserBinding, TransitionValue, TransitionValueSource
} from "@openuji/journey-plugin/client";

/**
 * Nextcloud clients resolve bindings with the shared client helper (`@openuji/journey-plugin/client`);
 * these names keep the package's public binding types. Errors name the application as Nextcloud.
 */
export const application = "Nextcloud";
export type NextcloudTouchpointBinding = ClientTouchpointBinding;
export type NextcloudUserBinding = ClientUserBinding;
export type NextcloudTransitionValueSource = TransitionValueSource;
export type NextcloudTransitionValue = TransitionValue;
export type NextcloudResolverOptions<TEntry> = ClientBindingOptions<TEntry>;
