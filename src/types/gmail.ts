export interface GmailUser {
  email: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  sub?: string;
}

export interface GmailConnectionState {
  accounts: GmailAccountState[];
  activeAccountEmail?: string;
  connected: boolean;
  connectedAt?: number;
  expiresAt?: number;
  lastConnectionError?: string;
  maxAccounts: number;
  pluginInstalled: boolean;
  pluginInstalledAt?: number;
  scopes: string[];
  user?: GmailUser;
}

export interface GmailAccountState {
  active: boolean;
  connectedAt?: number;
  email: string;
  expiresAt?: number;
  scopes: string[];
  user: GmailUser;
}

export interface GmailAuthenticatedRequest {
  accountEmail?: string;
  clientId?: string;
}

export interface GmailAccountEmailRequest {
  email: string;
}

export interface GmailListMessagesRequest extends GmailAuthenticatedRequest {
  includeSpamTrash?: boolean;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
  query?: string;
}

export interface GmailGetMessageRequest extends GmailAuthenticatedRequest {
  id: string;
  includeBody?: boolean;
  maxBodyChars?: number;
}

export interface GmailGetThreadRequest extends GmailAuthenticatedRequest {
  id: string;
  includeBody?: boolean;
  maxBodyChars?: number;
}

export interface GmailCreateDraftRequest extends GmailAuthenticatedRequest {
  bcc?: string[];
  body: string;
  cc?: string[];
  contentType?: "text/plain" | "text/html";
  from?: string;
  inReplyTo?: string;
  references?: string;
  subject: string;
  threadId?: string;
  to: string[];
}

export interface GmailSendMessageRequest extends GmailAuthenticatedRequest {
  bcc?: string[];
  body: string;
  cc?: string[];
  contentType?: "text/plain" | "text/html";
  from?: string;
  inReplyTo?: string;
  references?: string;
  subject: string;
  threadId?: string;
  to: string[];
}

export interface GmailSendSeparateMessagesRequest extends GmailAuthenticatedRequest {
  body: string;
  contentType?: "text/plain" | "text/html";
  from?: string;
  subject: string;
  to: string[];
}

export interface GmailSendDraftRequest extends GmailAuthenticatedRequest {
  draftId: string;
}

export interface GmailDeleteDraftRequest extends GmailAuthenticatedRequest {
  draftId: string;
}

export interface GmailModifyMessageLabelsRequest extends GmailAuthenticatedRequest {
  addLabelIds?: string[];
  id: string;
  removeLabelIds?: string[];
}

export interface GmailBatchModifyMessagesRequest extends GmailAuthenticatedRequest {
  addLabelIds?: string[];
  ids: string[];
  removeLabelIds?: string[];
}

export interface GmailMessageIdRequest extends GmailAuthenticatedRequest {
  id: string;
}

export interface GmailCreateLabelRequest extends GmailAuthenticatedRequest {
  labelListVisibility?: "labelShow" | "labelShowIfUnread" | "labelHide";
  messageListVisibility?: "show" | "hide";
  name: string;
}

export type GmailApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface GmailApiRequest extends GmailAuthenticatedRequest {
  body?: unknown;
  method: GmailApiMethod;
  path: string;
  query?: Record<string, unknown>;
}

export interface GmailMessageSummary {
  accountEmail?: string;
  date?: string;
  from?: string;
  id: string;
  internalDate?: string;
  labelIds: string[];
  snippet?: string;
  subject?: string;
  threadId?: string;
  to?: string;
}

export interface GmailMessageListResponse {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailAttachmentSummary {
  attachmentId?: string;
  contentId?: string;
  filename: string;
  isImage: boolean;
  mimeType?: string;
  size?: number;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  bcc?: string;
  body?: string;
  bodyTruncated: boolean;
  cc?: string;
  inReplyTo?: string;
  links: string[];
  messageId?: string;
  references?: string;
  attachments: GmailAttachmentSummary[];
}

export interface GmailThreadDetail {
  id: string;
  messages: GmailMessageDetail[];
}

export interface GmailLabel {
  id: string;
  labelListVisibility?: string;
  labelType?: string;
  messageListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  name: string;
  threadsTotal?: number;
  threadsUnread?: number;
}

export interface GmailLabelsResponse {
  labels: GmailLabel[];
}

export interface GmailDraftResponse {
  id: string;
  message?: GmailMessageSummary;
}

export interface GmailSendSeparateMessagesResponse {
  accountEmail?: string;
  failedCount: number;
  results: GmailSendSeparateMessageResult[];
  sentCount: number;
}

export interface GmailSendSeparateMessageResult {
  error?: string;
  message?: GmailMessageSummary;
  ok: boolean;
  to: string;
}

export interface GmailActionResponse {
  accountEmail?: string;
  message: string;
  messageDetail?: GmailMessageSummary;
}

export interface GmailBatchActionResponse {
  accountEmail?: string;
  message: string;
  modifiedCount: number;
}

export interface GmailApiResponse {
  accountEmail?: string;
  data: unknown;
  message: string;
  method: GmailApiMethod;
  path: string;
}
