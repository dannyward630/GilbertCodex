import { invoke } from "@tauri-apps/api/core";
import { loadGoogleOAuthSettings } from "../lib/appStorage";
import { GMAIL_CORE_OAUTH_SCOPES } from "../lib/googleOAuthScopes";
import { isTauriDesktopRuntime } from "./tauriClient";
import type {
  GmailActionResponse,
  GmailAccountEmailRequest,
  GmailApiRequest,
  GmailApiResponse,
  GmailBatchActionResponse,
  GmailBatchModifyMessagesRequest,
  GmailConnectionState,
  GmailCreateDraftRequest,
  GmailCreateLabelRequest,
  GmailDeleteDraftRequest,
  GmailDraftResponse,
  GmailGetMessageRequest,
  GmailGetThreadRequest,
  GmailLabel,
  GmailLabelsResponse,
  GmailListMessagesRequest,
  GmailMessageDetail,
  GmailMessageIdRequest,
  GmailMessageListResponse,
  GmailModifyMessageLabelsRequest,
  GmailSendMessageRequest,
  GmailSendSeparateMessagesRequest,
  GmailSendSeparateMessagesResponse,
  GmailSendDraftRequest,
  GmailThreadDetail,
} from "../types/gmail";

export { GMAIL_CORE_OAUTH_SCOPES };

const DEFAULT_GMAIL_OAUTH_SCOPE = GMAIL_CORE_OAUTH_SCOPES.join(" ");

export interface GmailConnectOAuthRequest {
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export function gmailDesktopAvailable() {
  return isTauriDesktopRuntime();
}

export function getDefaultGoogleOAuthClientId() {
  return loadGoogleOAuthSettings().clientId;
}

export function getDefaultGoogleOAuthClientSecret() {
  return loadGoogleOAuthSettings().clientSecret;
}

export function getDefaultGmailOAuthScope() {
  return DEFAULT_GMAIL_OAUTH_SCOPE;
}

export async function getGmailState(): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_get_state");
}

export async function installGmailPlugin(): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_install_plugin");
}

export async function connectGmailOAuth(request: GmailConnectOAuthRequest): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_connect_oauth", {
    request: {
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      scope: request.scope || DEFAULT_GMAIL_OAUTH_SCOPE,
    },
  });
}

export async function disconnectGmail(): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_disconnect");
}

export async function disconnectGmailAccount(request: GmailAccountEmailRequest): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_disconnect_account", {
    request,
  });
}

export async function setActiveGmailAccount(request: GmailAccountEmailRequest): Promise<GmailConnectionState> {
  assertGmailDesktop();
  return invoke<GmailConnectionState>("gmail_set_active_account", {
    request,
  });
}

export async function listGmailMessages(request: GmailListMessagesRequest = {}): Promise<GmailMessageListResponse> {
  assertGmailDesktop();
  return invoke<GmailMessageListResponse>("gmail_list_messages", {
    request: withDefaultClientId(request),
  });
}

export async function getGmailMessage(request: GmailGetMessageRequest): Promise<GmailMessageDetail> {
  assertGmailDesktop();
  return invoke<GmailMessageDetail>("gmail_get_message", {
    request: withDefaultClientId(request),
  });
}

export async function getGmailThread(request: GmailGetThreadRequest): Promise<GmailThreadDetail> {
  assertGmailDesktop();
  return invoke<GmailThreadDetail>("gmail_get_thread", {
    request: withDefaultClientId(request),
  });
}

export async function listGmailLabels(request: { accountEmail?: string; clientId?: string } = {}): Promise<GmailLabelsResponse> {
  assertGmailDesktop();
  return invoke<GmailLabelsResponse>("gmail_list_labels", {
    request: withDefaultClientId(request),
  });
}

export async function createGmailLabel(request: GmailCreateLabelRequest): Promise<GmailLabel> {
  assertGmailDesktop();
  return invoke<GmailLabel>("gmail_create_label", {
    request: withDefaultClientId(request),
  });
}

export async function createGmailDraft(request: GmailCreateDraftRequest): Promise<GmailDraftResponse> {
  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_create_draft", {
    request: withDefaultClientId(request),
  });
}

export async function sendGmailMessage(request: GmailSendMessageRequest): Promise<GmailDraftResponse> {
  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_send_message", {
    request: withDefaultClientId(request),
  });
}

export async function sendSeparateGmailMessages(request: GmailSendSeparateMessagesRequest): Promise<GmailSendSeparateMessagesResponse> {
  assertGmailDesktop();
  return invoke<GmailSendSeparateMessagesResponse>("gmail_send_separate_messages", {
    request: withDefaultClientId(request),
  });
}

export async function sendGmailDraft(request: GmailSendDraftRequest): Promise<GmailDraftResponse> {
  assertGmailDesktop();
  return invoke<GmailDraftResponse>("gmail_send_draft", {
    request: withDefaultClientId(request),
  });
}

export async function deleteGmailDraft(request: GmailDeleteDraftRequest): Promise<GmailActionResponse> {
  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_delete_draft", {
    request: withDefaultClientId(request),
  });
}

export async function modifyGmailMessageLabels(request: GmailModifyMessageLabelsRequest): Promise<GmailActionResponse> {
  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_modify_message_labels", {
    request: withDefaultClientId(request),
  });
}

export async function batchModifyGmailMessages(request: GmailBatchModifyMessagesRequest): Promise<GmailBatchActionResponse> {
  assertGmailDesktop();
  return invoke<GmailBatchActionResponse>("gmail_batch_modify_messages", {
    request: withDefaultClientId(request),
  });
}

export async function trashGmailMessage(request: GmailMessageIdRequest): Promise<GmailActionResponse> {
  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_trash_message", {
    request: withDefaultClientId(request),
  });
}

export async function untrashGmailMessage(request: GmailMessageIdRequest): Promise<GmailActionResponse> {
  assertGmailDesktop();
  return invoke<GmailActionResponse>("gmail_untrash_message", {
    request: withDefaultClientId(request),
  });
}

export async function requestGmailApi(request: GmailApiRequest): Promise<GmailApiResponse> {
  assertGmailDesktop();
  return invoke<GmailApiResponse>("gmail_api", {
    request: withDefaultClientId(request),
  });
}

function assertGmailDesktop() {
  if (!gmailDesktopAvailable()) {
    throw new Error("Gmail integration is available in the Tauri desktop app.");
  }
}

function withDefaultClientId<TRequest extends { clientId?: string }>(request: TRequest): TRequest {
  return {
    ...request,
    clientId: request.clientId || getDefaultGoogleOAuthClientId() || undefined,
  };
}
