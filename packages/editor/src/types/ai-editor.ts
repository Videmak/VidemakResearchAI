import type { Block } from '@blocknote/core';

export type AIEditorAccessRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export type AIEditorSaveState = 'loading' | 'saved' | 'saving' | 'syncing' | 'error';

export interface AIEditorCursorState {
  blockId: string | null;
  label: string;
  updatedAt: number;
}

export interface AIEditorCollaborator {
  sessionId: string;
  displayName: string;
  color: string;
  role: AIEditorAccessRole;
  lastSeenAt: number;
  isCurrentUser: boolean;
  cursor?: AIEditorCursorState | null;
}

export interface AIEditorDocumentMember {
  id: string;
  displayName: string;
  email: string;
  role: Exclude<AIEditorAccessRole, 'owner'>;
  addedAt: number;
}

export interface AIEditorComment {
  id: string;
  actorSessionId: string;
  actorDisplayName: string;
  text: string;
  selectedText?: string;
  blockId?: string | null;
  createdAt: number;
  updatedAt?: number;
  status?: 'open' | 'resolved';
  resolvedAt?: number | null;
  resolvedBySessionId?: string | null;
  resolvedByDisplayName?: string | null;
  replies?: AIEditorCommentReply[];
  /** Set on review comments written by Videmak AI. */
  kind?: 'ai-review';
  severity?: 'minor' | 'major';
  category?: string;
  /** Replacement text for `selectedText` the writer can accept. */
  suggestion?: string | null;
  feedback?: 'up' | 'down' | null;
  /** Which Review panel check wrote it (claims, proofread, tone); unset for margin reviews. */
  check?: string;
}

export type AIEditorReviewCommentInput = {
  blockId: string;
  quote: string;
  comment: string;
  severity: 'minor' | 'major';
  category: string;
  suggestion?: string | null;
  check?: string;
};

export interface AIEditorCommentReply {
  id: string;
  actorSessionId: string;
  actorDisplayName: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  /** A reply written by Videmak AI. */
  ai?: boolean;
}

export interface AIEditorBookmark {
  id: string;
  actorSessionId: string;
  actorDisplayName: string;
  label: string;
  blockId: string;
  createdAt: number;
}

export type AIEditorActivityAction =
  | 'document_created'
  | 'title_updated'
  | 'content_updated'
  | 'share_updated'
  | 'member_added'
  | 'member_role_updated'
  | 'member_removed'
  | 'comment_added'
  | 'bookmark_added';

export interface AIEditorActivityEntry {
  id: string;
  action: AIEditorActivityAction;
  actorSessionId: string;
  actorDisplayName: string;
  timestamp: number;
  description: string;
}

export interface AIEditorShareSettings {
  isLinkSharingEnabled: boolean;
  defaultAccessRole: Exclude<AIEditorAccessRole, 'owner'>;
  updatedAt: number;
}

export interface AIEditorDocumentSnapshot {
  id: string;
  title: string;
  blocks: Block<any, any, any>[];
  ownerSessionId: string;
  revision: number;
  updatedAt: number;
  updatedBySessionId: string;
  share: AIEditorShareSettings;
  members: AIEditorDocumentMember[];
  bookmarks: AIEditorBookmark[];
  comments: AIEditorComment[];
  activity: AIEditorActivityEntry[];
  /** Word page setup, headers/footers, styles; null for documents never opened from Word. */
  wordSettings?: Record<string, any> | null;
}

export interface AIEditorDocumentSummary {
  id: string;
  title: string;
  updatedAt: number;
  ownerSessionId: string;
  share: AIEditorShareSettings;
  memberCount: number;
  memberEmails: string[];
  /** Words in the document, when the server sends it with the list. */
  wordCount?: number;
}
