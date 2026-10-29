'use client';

import type { Block } from '@blocknote/core';
import { getEditorConfig } from '../../runtime';
import type {
  AIEditorAccessRole,
  AIEditorActivityAction,
  AIEditorActivityEntry,
  AIEditorBookmark,
  AIEditorComment,
  AIEditorCollaborator,
  AIEditorCursorState,
  AIEditorDocumentMember,
  AIEditorDocumentSnapshot,
  AIEditorDocumentSummary,
  AIEditorShareSettings,
} from '../../types/ai-editor';

const DOCUMENT_STORAGE_PREFIX = 'ai-editor-document';
const DOCUMENT_INDEX_STORAGE_KEY = 'ai-editor-documents-index';
const SESSION_STORAGE_KEY = 'ai-editor-session';
const INDEX_CHANNEL_NAME = 'ai-editor:index';
const PRESENCE_TTL_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 5000;

const COLLABORATOR_COLORS = [
  '#1a73e8',
  '#188038',
  '#c5221f',
  '#7c4dff',
  '#e37400',
  '#00639b',
  '#b3261e',
  '#0b57d0',
];

type PresenceMessage = {
  type: 'presence:request' | 'presence:update';
  collaborator: AIEditorCollaborator;
};

type DocumentMessage = {
  type: 'document:update';
  snapshot: AIEditorDocumentSnapshot;
};

type IndexMessage = {
  type: 'index:update';
  documents: AIEditorDocumentSummary[];
};

type CollaborationMessage = PresenceMessage | DocumentMessage;

type DocumentSubscriptionOptions = {
  documentId: string;
  session: AIEditorCollaborator;
  requestedRole: AIEditorAccessRole | null;
  onSnapshot: (snapshot: AIEditorDocumentSnapshot, meta: { remote: boolean }) => void;
  onCollaborators: (collaborators: AIEditorCollaborator[]) => void;
};

export interface AIEditorProvider {
  getSession(): AIEditorCollaborator;
  updateSessionDisplayName(displayName: string): AIEditorCollaborator;
  createDocument(sessionId: string): string;
  deleteDocument(documentId: string, sessionId: string): Promise<void>;
  getDocument(documentId: string, ownerSessionId: string): AIEditorDocumentSnapshot;
  listDocuments(): AIEditorDocumentSummary[];
  listDocumentsSharedWith(email: string): AIEditorDocumentSummary[];
  subscribeToDocuments(listener: (documents: AIEditorDocumentSummary[]) => void): () => void;
  subscribeToDocument(options: DocumentSubscriptionOptions): () => void;
  updateTitle(documentId: string, sessionId: string, title: string): AIEditorDocumentSnapshot;
  updateBlocks(
    documentId: string,
    sessionId: string,
    blocks: Block<any, any, any>[],
  ): AIEditorDocumentSnapshot;
  persistBlocks(
    documentId: string,
    sessionId: string,
    blocks: Block<any, any, any>[],
  ): Promise<AIEditorDocumentSnapshot>;
  updateShareSettings(
    documentId: string,
    sessionId: string,
    nextShare: Partial<AIEditorShareSettings>,
  ): AIEditorDocumentSnapshot;
  addMember(
    documentId: string,
    sessionId: string,
    member: Omit<AIEditorDocumentMember, 'id' | 'addedAt'>,
  ): AIEditorDocumentSnapshot;
  updateMemberRole(
    documentId: string,
    sessionId: string,
    memberId: string,
    role: Exclude<AIEditorAccessRole, 'owner'>,
  ): AIEditorDocumentSnapshot;
  removeMember(documentId: string, sessionId: string, memberId: string): AIEditorDocumentSnapshot;
  addComment(
    documentId: string,
    sessionId: string,
    comment: {
      text: string;
      selectedText?: string;
      blockId?: string | null;
    },
  ): AIEditorDocumentSnapshot;
  updateComments(
    documentId: string,
    sessionId: string,
    comments: AIEditorComment[],
  ): AIEditorDocumentSnapshot;
  addBookmark(
    documentId: string,
    sessionId: string,
    bookmark: {
      label: string;
      blockId: string;
    },
  ): AIEditorDocumentSnapshot;
  updateCursor(
    documentId: string,
    session: AIEditorCollaborator,
    cursor: AIEditorCursorState | null,
  ): void;
  getEffectiveRole(
    snapshot: AIEditorDocumentSnapshot,
    sessionId: string,
    requestedRole: AIEditorAccessRole | null,
    authenticatedEmail?: string | null,
  ): AIEditorAccessRole;
}

function getStorageKey(documentId: string) {
  return `${DOCUMENT_STORAGE_PREFIX}:${documentId}`;
}

function createStarterBlocks(): Block<any, any, any>[] {
  return [
    {
      id: crypto.randomUUID(),
      type: 'heading',
      props: { level: 1 },
      content: [{ type: 'text', text: 'Untitled document', styles: {} }],
      children: [],
    },
    {
      id: crypto.randomUUID(),
      type: 'paragraph',
      props: {},
      content: [
        {
          type: 'text',
          text: 'Start writing here. Open this document in another tab to test live sync and presence.',
          styles: {},
        },
      ],
      children: [],
    },
  ];
}

function buildSessionId() {
  return `session-${crypto.randomUUID()}`;
}

function getColorForSession(sessionId: string) {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(index);
    hash |= 0;
  }

  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}

function buildDisplayName(sessionId: string) {
  return `Guest ${sessionId.slice(-4).toUpperCase()}`;
}

/** The signed-in person's name, which beats a stored or generated guest name. */
function signedInName() {
  const user = getEditorConfig().user;
  return (user?.full_name || user?.username || user?.email?.split('@')[0] || '').trim() || null;
}

function createSession(): AIEditorCollaborator {
  const sessionId = buildSessionId();
  return {
    sessionId,
    displayName: signedInName() || buildDisplayName(sessionId),
    color: getColorForSession(sessionId),
    role: 'owner',
    lastSeenAt: Date.now(),
    isCurrentUser: true,
  };
}

function persistSession(session: AIEditorCollaborator) {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function sanitizeSnapshot(value: unknown): AIEditorDocumentSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<AIEditorDocumentSnapshot>;
  if (
    typeof snapshot.id !== 'string' ||
    typeof snapshot.title !== 'string' ||
    !Array.isArray(snapshot.blocks) ||
    typeof snapshot.ownerSessionId !== 'string' ||
    typeof snapshot.revision !== 'number' ||
    typeof snapshot.updatedAt !== 'number' ||
    typeof snapshot.updatedBySessionId !== 'string'
  ) {
    return null;
  }

  const share = snapshot.share;
  if (
    !share ||
    typeof share !== 'object' ||
    typeof share.isLinkSharingEnabled !== 'boolean' ||
    typeof share.defaultAccessRole !== 'string' ||
    typeof share.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    ...snapshot,
    members: Array.isArray(snapshot.members) ? snapshot.members : [],
    bookmarks: Array.isArray((snapshot as { bookmarks?: unknown[] }).bookmarks)
      ? ((snapshot as { bookmarks?: AIEditorBookmark[] }).bookmarks ?? [])
      : [],
    comments: Array.isArray((snapshot as { comments?: unknown[] }).comments)
      ? ((snapshot as { comments?: AIEditorComment[] }).comments ?? [])
      : [],
    activity: Array.isArray(snapshot.activity) ? snapshot.activity : [],
  } as AIEditorDocumentSnapshot;
}

function persistSnapshot(snapshot: AIEditorDocumentSnapshot) {
  window.localStorage.setItem(getStorageKey(snapshot.id), JSON.stringify(snapshot));
}

function loadSnapshot(documentId: string): AIEditorDocumentSnapshot | null {
  const raw = window.localStorage.getItem(getStorageKey(documentId));
  if (!raw) {
    return null;
  }

  try {
    return sanitizeSnapshot(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to parse ai-editor snapshot:', error);
    return null;
  }
}

function createSnapshot(documentId: string, ownerSessionId: string): AIEditorDocumentSnapshot {
  const now = Date.now();
  const ownerDisplayName = buildDisplayName(ownerSessionId);
  return {
    id: documentId,
    title: 'Untitled document',
    blocks: createStarterBlocks(),
    ownerSessionId,
    revision: 1,
    updatedAt: now,
    updatedBySessionId: ownerSessionId,
    share: {
      isLinkSharingEnabled: false,
      defaultAccessRole: 'editor',
      updatedAt: now,
    },
    members: [],
    bookmarks: [],
    comments: [],
    activity: [
      {
        id: crypto.randomUUID(),
        action: 'document_created',
        actorSessionId: ownerSessionId,
        actorDisplayName: ownerDisplayName,
        timestamp: now,
        description: 'Created the document',
      },
    ],
  };
}

function toSummary(snapshot: AIEditorDocumentSnapshot): AIEditorDocumentSummary {
  return {
    id: snapshot.id,
    title: snapshot.title,
    updatedAt: snapshot.updatedAt,
    ownerSessionId: snapshot.ownerSessionId,
    share: snapshot.share,
    memberCount: snapshot.members.length,
    memberEmails: snapshot.members.map((member) => member.email.toLowerCase()),
  };
}

function sortDocuments(documents: AIEditorDocumentSummary[]) {
  return [...documents].sort((left, right) => right.updatedAt - left.updatedAt);
}

function loadDocumentIndex(): AIEditorDocumentSummary[] {
  const raw = window.localStorage.getItem(DOCUMENT_INDEX_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as AIEditorDocumentSummary[];
    return Array.isArray(parsed) ? sortDocuments(parsed) : [];
  } catch (error) {
    console.error('Failed to load ai-editor document index:', error);
    return [];
  }
}

const documentIndexListeners = new Set<(documents: AIEditorDocumentSummary[]) => void>();

// BroadcastChannel only syncs other tabs; it is missing in Safari < 15.4,
// where constructing it threw on every local save.
function openBroadcastChannel(name: string): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
}

function notifyDocumentIndex(documents: AIEditorDocumentSummary[]) {
  const nextDocuments = sortDocuments(documents);
  window.localStorage.setItem(DOCUMENT_INDEX_STORAGE_KEY, JSON.stringify(nextDocuments));
  documentIndexListeners.forEach((listener) => listener(nextDocuments));

  const channel = openBroadcastChannel(INDEX_CHANNEL_NAME);
  channel?.postMessage({ type: 'index:update', documents: nextDocuments } satisfies IndexMessage);
  channel?.close();
}

function upsertDocumentIndex(snapshot: AIEditorDocumentSnapshot) {
  const nextSummary = toSummary(snapshot);
  const currentDocuments = loadDocumentIndex();
  const nextDocuments = sortDocuments([
    nextSummary,
    ...currentDocuments.filter((document) => document.id !== snapshot.id),
  ]);
  notifyDocumentIndex(nextDocuments);
}

function removeDocumentFromIndex(documentId: string) {
  const nextDocuments = loadDocumentIndex().filter((document) => document.id !== documentId);
  notifyDocumentIndex(nextDocuments);
}

function broadcastDocumentUpdate(snapshot: AIEditorDocumentSnapshot) {
  const channel = openBroadcastChannel(`ai-editor:${snapshot.id}`);
  channel?.postMessage({ type: 'document:update', snapshot } satisfies DocumentMessage);
  channel?.close();
}

function commitDocumentUpdate(
  documentId: string,
  sessionId: string,
  updater: (current: AIEditorDocumentSnapshot, actorDisplayName: string) => AIEditorDocumentSnapshot,
) {
  const current = loadSnapshot(documentId) ?? createSnapshot(documentId, sessionId);
  const actorDisplayName = getStoredDisplayNameForSession(sessionId);
  const nextSnapshot = updater(current, actorDisplayName);
  persistSnapshot(nextSnapshot);
  upsertDocumentIndex(nextSnapshot);
  broadcastDocumentUpdate(nextSnapshot);
  return nextSnapshot;
}

function getStoredDisplayNameForSession(sessionId: string) {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return buildDisplayName(sessionId);
  }

  try {
    const parsed = JSON.parse(raw) as AIEditorCollaborator;
    if (parsed.sessionId === sessionId && parsed.displayName) {
      return parsed.displayName;
    }
  } catch (error) {
    console.error('Failed to parse ai-editor session for activity log:', error);
  }

  return buildDisplayName(sessionId);
}

function appendActivity(
  current: AIEditorDocumentSnapshot,
  sessionId: string,
  actorDisplayName: string,
  action: AIEditorActivityAction,
  description: string,
) {
  const nextEntry: AIEditorActivityEntry = {
    id: crypto.randomUUID(),
    action,
    actorSessionId: sessionId,
    actorDisplayName,
    timestamp: Date.now(),
    description,
  };

  return [nextEntry, ...current.activity].slice(0, 40);
}

function getEffectiveRole(
  snapshot: AIEditorDocumentSnapshot,
  sessionId: string,
  requestedRole: AIEditorAccessRole | null,
  authenticatedEmail?: string | null,
): AIEditorAccessRole {
  if (snapshot.ownerSessionId === sessionId) {
    return 'owner';
  }

  const normalizedEmail = authenticatedEmail?.trim().toLowerCase();
  if (normalizedEmail) {
    const invitedMember = snapshot.members.find((member) => member.email.toLowerCase() === normalizedEmail);
    if (invitedMember) {
      return invitedMember.role;
    }
  }

  if (!snapshot.share.isLinkSharingEnabled) {
    return 'viewer';
  }

  if (requestedRole && requestedRole !== 'owner') {
    return requestedRole;
  }

  return snapshot.share.defaultAccessRole;
}

function sortCollaborators(collaborators: AIEditorCollaborator[]) {
  return [...collaborators].sort((left, right) => {
    if (left.isCurrentUser && !right.isCurrentUser) {
      return -1;
    }

    if (!left.isCurrentUser && right.isCurrentUser) {
      return 1;
    }

    return right.lastSeenAt - left.lastSeenAt;
  });
}

export function createLocalAIEditorProvider(): AIEditorProvider {
  return {
    getSession() {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as AIEditorCollaborator;
          return {
            ...parsed,
            color: parsed.color || getColorForSession(parsed.sessionId),
            displayName: signedInName() || parsed.displayName || buildDisplayName(parsed.sessionId),
            role: 'owner',
            lastSeenAt: Date.now(),
            isCurrentUser: true,
          };
        } catch (error) {
          console.error('Failed to restore ai-editor session:', error);
        }
      }

      const nextSession = createSession();
      persistSession(nextSession);
      return nextSession;
    },

    updateSessionDisplayName(displayName) {
      const currentSession = this.getSession();
      const nextSession = {
        ...currentSession,
        displayName: displayName.trim() || currentSession.displayName,
        lastSeenAt: Date.now(),
      };
      persistSession(nextSession);
      return nextSession;
    },

    createDocument(sessionId) {
      const documentId = crypto.randomUUID();
      const snapshot = createSnapshot(documentId, sessionId);
      persistSnapshot(snapshot);
      upsertDocumentIndex(snapshot);
      return documentId;
    },

    async deleteDocument(documentId, sessionId) {
      const snapshot = loadSnapshot(documentId);
      if (!snapshot) {
        removeDocumentFromIndex(documentId);
        return;
      }

      const role = getEffectiveRole(snapshot, sessionId, 'owner');
      if (role !== 'owner') {
        throw new Error('Only the owner can delete this document');
      }

      window.localStorage.removeItem(getStorageKey(documentId));
      removeDocumentFromIndex(documentId);
    },

    getDocument(documentId, ownerSessionId) {
      const snapshot = loadSnapshot(documentId) ?? createSnapshot(documentId, ownerSessionId);
      persistSnapshot(snapshot);
      upsertDocumentIndex(snapshot);
      return snapshot;
    },

    listDocuments() {
      return loadDocumentIndex();
    },

    listDocumentsSharedWith(email) {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        return [];
      }

      return loadDocumentIndex().filter((document) =>
        document.memberEmails.some((memberEmail) => memberEmail === normalizedEmail),
      );
    },

    subscribeToDocuments(listener) {
      documentIndexListeners.add(listener);
      listener(loadDocumentIndex());

      const channel = openBroadcastChannel(INDEX_CHANNEL_NAME);
      if (channel) {
        channel.onmessage = (event: MessageEvent<IndexMessage>) => {
          if (event.data?.type === 'index:update') {
            listener(sortDocuments(event.data.documents));
          }
        };
      }

      return () => {
        documentIndexListeners.delete(listener);
        channel?.close();
      };
    },

    subscribeToDocument({
      documentId,
      session,
      requestedRole,
      onSnapshot,
      onCollaborators,
    }) {
      let currentSnapshot = this.getDocument(documentId, session.sessionId);
      let presenceMap: Record<string, AIEditorCollaborator> = {
        [session.sessionId]: {
          ...session,
          role: getEffectiveRole(currentSnapshot, session.sessionId, requestedRole),
          lastSeenAt: Date.now(),
          isCurrentUser: true,
        },
      };

      const channel = openBroadcastChannel(`ai-editor:${documentId}`);

      const emitCollaborators = () => {
        onCollaborators(
          sortCollaborators(Object.values(presenceMap)).map((collaborator) => ({
            ...collaborator,
            role: getEffectiveRole(currentSnapshot, collaborator.sessionId, collaborator.role),
          })),
        );
      };

      const announcePresence = () => {
        const collaborator: AIEditorCollaborator = {
          ...session,
          role: getEffectiveRole(currentSnapshot, session.sessionId, requestedRole),
          lastSeenAt: Date.now(),
          isCurrentUser: true,
        };

        presenceMap = {
          ...presenceMap,
          [collaborator.sessionId]: collaborator,
        };

        channel?.postMessage({ type: 'presence:update', collaborator } satisfies PresenceMessage);
        emitCollaborators();
      };

      const handleChannelMessage = (event: MessageEvent<CollaborationMessage>) => {
        const message = event.data;
        if (!message) {
          return;
        }

        if (message.type === 'presence:request') {
          announcePresence();
          return;
        }

        if (message.type === 'presence:update') {
          presenceMap = {
            ...presenceMap,
            [message.collaborator.sessionId]: {
              ...message.collaborator,
              isCurrentUser: message.collaborator.sessionId === session.sessionId,
              lastSeenAt: Date.now(),
            },
          };
          emitCollaborators();
          return;
        }

        if (
          message.type === 'document:update' &&
          message.snapshot.id === documentId &&
          message.snapshot.updatedBySessionId !== session.sessionId &&
          message.snapshot.revision > currentSnapshot.revision
        ) {
          currentSnapshot = message.snapshot;
          persistSnapshot(currentSnapshot);
          upsertDocumentIndex(currentSnapshot);
          onSnapshot(currentSnapshot, { remote: true });
          emitCollaborators();
        }
      };

      if (channel) {
        channel.onmessage = handleChannelMessage;
      }

      const heartbeatInterval = window.setInterval(() => {
        announcePresence();
        const now = Date.now();
        presenceMap = Object.fromEntries(
          Object.entries(presenceMap).filter(([, collaborator]) => now - collaborator.lastSeenAt < PRESENCE_TTL_MS),
        );
        emitCollaborators();
      }, HEARTBEAT_INTERVAL_MS);

      channel?.postMessage({
        type: 'presence:request',
        collaborator: {
          ...session,
          role: getEffectiveRole(currentSnapshot, session.sessionId, requestedRole),
          lastSeenAt: Date.now(),
          isCurrentUser: true,
        },
      } satisfies PresenceMessage);

      onSnapshot(currentSnapshot, { remote: false });
      emitCollaborators();
      announcePresence();

      return () => {
        window.clearInterval(heartbeatInterval);
        channel?.close();
      };
    },

    updateTitle(documentId, sessionId, title) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => ({
        ...current,
        title,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
        activity: appendActivity(current, sessionId, actorDisplayName, 'title_updated', `Renamed the document to "${title}"`),
      }));
    },

    updateBlocks(documentId, sessionId, blocks) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => ({
        ...current,
        blocks,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
        activity: appendActivity(current, sessionId, actorDisplayName, 'content_updated', 'Updated the document content'),
      }));
    },

    persistBlocks(documentId, sessionId, blocks) {
      // Commit inside the executor so a localStorage failure (quota, blocked
      // storage) becomes a rejection the autosave handles, not a throw.
      return new Promise<AIEditorDocumentSnapshot>((resolve) => {
        resolve(
          commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => ({
            ...current,
            blocks,
            revision: current.revision + 1,
            updatedAt: Date.now(),
            updatedBySessionId: sessionId,
            activity: appendActivity(current, sessionId, actorDisplayName, 'content_updated', 'Updated the document content'),
          })),
        );
      });
    },

    updateShareSettings(documentId, sessionId, nextShare) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => ({
        ...current,
        share: {
          ...current.share,
          ...nextShare,
          updatedAt: Date.now(),
        },
        revision: current.revision + 1,
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
        activity: appendActivity(current, sessionId, actorDisplayName, 'share_updated', 'Updated general sharing settings'),
      }));
    },

    addMember(documentId, sessionId, member) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => {
        const normalizedEmail = member.email.trim().toLowerCase();
        const existingMember = current.members.find((entry) => entry.email.toLowerCase() === normalizedEmail);
        const nextMembers = existingMember
          ? current.members.map((entry) =>
              entry.id === existingMember.id
                ? {
                    ...entry,
                    displayName: member.displayName.trim() || entry.displayName,
                    role: member.role,
                  }
                : entry,
            )
          : [
              {
                id: crypto.randomUUID(),
                displayName: member.displayName.trim() || normalizedEmail,
                email: normalizedEmail,
                role: member.role,
                addedAt: Date.now(),
              },
              ...current.members,
            ];

        return {
          ...current,
          members: nextMembers,
          revision: current.revision + 1,
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
          activity: appendActivity(
            current,
            sessionId,
            actorDisplayName,
            'member_added',
            existingMember
              ? `Updated ${member.displayName.trim() || normalizedEmail} to ${member.role}`
              : `Added ${member.displayName.trim() || normalizedEmail} as ${member.role}`,
          ),
        };
      });
    },

    updateMemberRole(documentId, sessionId, memberId, role) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => {
        const targetMember = current.members.find((member) => member.id === memberId);

        return {
          ...current,
          members: current.members.map((member) =>
            member.id === memberId
              ? {
                  ...member,
                  role,
                }
              : member,
          ),
          revision: current.revision + 1,
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
          activity: appendActivity(
            current,
            sessionId,
            actorDisplayName,
            'member_role_updated',
            `Changed ${targetMember?.displayName ?? 'a collaborator'} to ${role}`,
          ),
        };
      });
    },

    removeMember(documentId, sessionId, memberId) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => {
        const targetMember = current.members.find((member) => member.id === memberId);

        return {
          ...current,
          members: current.members.filter((member) => member.id !== memberId),
          revision: current.revision + 1,
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
          activity: appendActivity(
            current,
            sessionId,
            actorDisplayName,
            'member_removed',
            `Removed ${targetMember?.displayName ?? 'a collaborator'} from access`,
          ),
        };
      });
    },

    addComment(documentId, sessionId, comment) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => {
        const trimmedText = comment.text.trim();
        if (!trimmedText) {
          return current;
        }

        const nextComment: AIEditorComment = {
          id: crypto.randomUUID(),
          actorSessionId: sessionId,
          actorDisplayName,
          text: trimmedText,
          selectedText: comment.selectedText?.trim() || undefined,
          blockId: comment.blockId ?? null,
          createdAt: Date.now(),
        };

        return {
          ...current,
          comments: [nextComment, ...(current.comments ?? [])],
          revision: current.revision + 1,
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
          activity: appendActivity(
            current,
            sessionId,
            actorDisplayName,
            'comment_added',
            nextComment.selectedText
              ? `Added a comment on "${nextComment.selectedText}"`
              : 'Added a comment',
          ),
        };
      });
    },

    updateComments(documentId, sessionId, comments) {
      return commitDocumentUpdate(documentId, sessionId, (current) => ({
        ...current,
        comments,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));
    },

    addBookmark(documentId, sessionId, bookmark) {
      return commitDocumentUpdate(documentId, sessionId, (current, actorDisplayName) => {
        const trimmedLabel = bookmark.label.trim();
        const blockId = bookmark.blockId.trim();
        if (!trimmedLabel || !blockId) {
          return current;
        }

        const nextBookmark: AIEditorBookmark = {
          id: crypto.randomUUID(),
          actorSessionId: sessionId,
          actorDisplayName,
          label: trimmedLabel,
          blockId,
          createdAt: Date.now(),
        };

        return {
          ...current,
          bookmarks: [nextBookmark, ...(current.bookmarks ?? [])],
          revision: current.revision + 1,
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
          activity: appendActivity(
            current,
            sessionId,
            actorDisplayName,
            'bookmark_added',
            `Added bookmark "${trimmedLabel}"`,
          ),
        };
      });
    },

    updateCursor() {},

    getEffectiveRole,
  };
}
