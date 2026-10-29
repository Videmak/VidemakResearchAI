'use client';

import type { Block } from '@blocknote/core';
import { createLocalAIEditorProvider, type AIEditorProvider } from './provider';
import type {
  AIEditorAccessRole,
  AIEditorBookmark,
  AIEditorComment,
  AIEditorCollaborator,
  AIEditorCursorState,
  AIEditorDocumentSnapshot,
  AIEditorDocumentSummary,
  AIEditorShareSettings,
} from '../../types/ai-editor';
import { getApiBase, getAuthHeader, getAuthToken, hasToken } from '../../utils/auth/api';

type DocumentSubscriptionOptions = Parameters<AIEditorProvider['subscribeToDocument']>[0];
type SnapshotListener = (snapshot: AIEditorDocumentSnapshot, meta: { remote: boolean }) => void;
type CollaboratorListener = (collaborators: AIEditorCollaborator[]) => void;

type LiveConnection = {
  documentId: string;
  session: AIEditorCollaborator;
  requestedRole: AIEditorAccessRole | null;
  websocket: WebSocket | null;
  reconnectTimer: number | null;
  heartbeatTimer: number | null;
  shouldReconnect: boolean;
  lastCursor: AIEditorCursorState | null;
  consecutiveFailures: number;
  hasEverConnected: boolean;
};

type RealtimeEnvelope =
  | { type: 'sync:init'; snapshot: unknown; collaborators?: unknown[] }
  | { type: 'sync:document'; snapshot: unknown }
  | { type: 'sync:presence'; collaborators: unknown[] }
  | { type: 'error'; detail?: string }
  | { type: 'pong' };

const HEARTBEAT_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 1200;

const localFallback = createLocalAIEditorProvider();
const documentListeners = new Map<string, Set<SnapshotListener>>();
const collaboratorListeners = new Map<string, Set<CollaboratorListener>>();
const documentsListListeners = new Set<(documents: AIEditorDocumentSummary[]) => void>();
const snapshotCache = new Map<string, AIEditorDocumentSnapshot>();
const collaboratorCache = new Map<string, AIEditorCollaborator[]>();
const liveConnections = new Map<string, LiveConnection>();
const pendingBootstrapDocuments = new Set<string>();
let summaryCache: AIEditorDocumentSummary[] = [];

function getBackendUrl(path: string) {
  const base = getApiBase();
  return `${base}${path}`;
}

function getRealtimeBaseUrl() {
  // The host app decides where the API lives ('' = this site).
  return (getApiBase() || window.location.origin).replace(/\/+$/, '');
}

function createRealtimeUrl(documentId: string, requestedRole: AIEditorAccessRole | null) {
  const httpUrl = `${getRealtimeBaseUrl()}/api/ai-editor/documents/${documentId}/ws`;
  const baseUrl =
    httpUrl.startsWith('http://') || httpUrl.startsWith('https://')
      ? httpUrl
      : `${window.location.origin}${httpUrl}`;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  const token = getAuthToken();
  if (token) {
    url.searchParams.set('token', token);
  }
  if (requestedRole) {
    url.searchParams.set('access', requestedRole);
  }

  return url.toString();
}

function notifySummaryListeners() {
  documentsListListeners.forEach((listener) => listener(summaryCache));
}

function notifySnapshotListeners(documentId: string, snapshot: AIEditorDocumentSnapshot, remote: boolean) {
  const listeners = documentListeners.get(documentId);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener(snapshot, { remote }));
}

function notifyCollaboratorListeners(documentId: string, collaborators: AIEditorCollaborator[]) {
  collaboratorCache.set(documentId, collaborators);
  const listeners = collaboratorListeners.get(documentId);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener(collaborators));
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

function normalizeSummary(item: any): AIEditorDocumentSummary {
  return {
    id: item.id,
    title: item.title || 'Untitled document',
    updatedAt: Number(item.updatedAt || Date.now()),
    ownerSessionId: `owner-user-${item.ownerUserId || 'unknown'}`,
    share: item.share || item.shareSettings || {
      isLinkSharingEnabled: false,
      defaultAccessRole: 'editor',
      updatedAt: Date.now(),
    },
    memberCount: Number(item.memberCount || 0),
    memberEmails: Array.isArray(item.memberEmails) ? item.memberEmails : [],
    wordCount: Number.isFinite(Number(item.wordCount ?? item.word_count)) ? Number(item.wordCount ?? item.word_count) : undefined,
  };
}

function normalizeSnapshot(item: any): AIEditorDocumentSnapshot {
  const updatedAtMs =
    typeof item.updatedAt === 'string'
      ? new Date(item.updatedAt).getTime()
      : Number(item.updatedAt || Date.now());

  const snapshot: AIEditorDocumentSnapshot = {
    id: item.id,
    title: item.title || 'Untitled document',
    blocks: Array.isArray(item.blocks) ? item.blocks : [],
    ownerSessionId: `owner-user-${item.ownerUserId || 'unknown'}`,
    revision: updatedAtMs,
    updatedAt: updatedAtMs,
    updatedBySessionId:
      item.activity?.[0]?.actorSessionId || `owner-user-${item.ownerUserId || 'unknown'}`,
    share: item.share || item.shareSettings || {
      isLinkSharingEnabled: false,
      defaultAccessRole: 'editor',
      updatedAt: updatedAtMs,
    },
    members: Array.isArray(item.members) ? item.members : [],
    bookmarks: Array.isArray(item.bookmarks) ? item.bookmarks : [],
    comments: Array.isArray(item.comments) ? item.comments : [],
    activity: Array.isArray(item.activity) ? item.activity : [],
    wordSettings: item.wordSettings && typeof item.wordSettings === 'object' ? item.wordSettings : null,
  };

  (snapshot as any).currentUserRole = item.currentUserRole;
  (snapshot as any).canEdit = item.canEdit;
  (snapshot as any).canManageMembers = item.canManageMembers;
  return snapshot;
}

function normalizeCursor(item: any): AIEditorCursorState | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    blockId: typeof item.blockId === 'string' ? item.blockId : null,
    label: typeof item.label === 'string' && item.label.trim() ? item.label : 'Editing',
    updatedAt: Number(item.updatedAt || Date.now()),
  };
}

function normalizeCollaborators(items: unknown, currentSessionId: string): AIEditorCollaborator[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortCollaborators(
    items.map((item: any) => ({
      sessionId: String(item.sessionId || ''),
      displayName: String(item.displayName || 'Collaborator'),
      color: String(item.color || '#1a73e8'),
      role: (item.role || 'viewer') as AIEditorAccessRole,
      lastSeenAt: Number(item.lastSeenAt || Date.now()),
      isCurrentUser: String(item.sessionId || '') === currentSessionId,
      cursor: normalizeCursor(item.cursor),
    })),
  );
}

async function fetchJson(path: string, options?: RequestInit) {
  const response = await fetch(getBackendUrl(path), {
    ...options,
    headers: {
      ...(options?.headers || {}),
      ...getAuthHeader(),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail || `Request failed with ${response.status}`);
  }

  return response.json();
}

function optimisticSummaryFromSnapshot(snapshot: AIEditorDocumentSnapshot): AIEditorDocumentSummary {
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

function upsertSummary(summary: AIEditorDocumentSummary) {
  summaryCache = [summary, ...summaryCache.filter((item) => item.id !== summary.id)].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  notifySummaryListeners();
}

function removeDocumentFromCaches(documentId: string) {
  summaryCache = summaryCache.filter((item) => item.id !== documentId);
  snapshotCache.delete(documentId);
  collaboratorCache.delete(documentId);
  closeRealtimeConnection(documentId);
  notifySummaryListeners();
}

function applyRemoteSnapshot(documentId: string, payload: unknown, remote: boolean) {
  const snapshot = normalizeSnapshot(payload);
  snapshotCache.set(documentId, snapshot);
  upsertSummary(optimisticSummaryFromSnapshot(snapshot));
  notifySnapshotListeners(documentId, snapshot, remote);
}

async function refreshDocumentsFromBackend() {
  if (!hasToken()) {
    return;
  }

  try {
    const data = await fetchJson('/api/ai-editor/documents');
    summaryCache = Array.isArray(data.documents) ? data.documents.map(normalizeSummary) : [];
    notifySummaryListeners();
  } catch (error) {
    console.error('Failed to load ai-editor documents from backend:', error);
  }
}

async function bootstrapDocumentInBackend(
  documentId: string,
  sessionId: string,
  seedSnapshot?: AIEditorDocumentSnapshot | null,
) {
  if (pendingBootstrapDocuments.has(documentId)) {
    return;
  }

  pendingBootstrapDocuments.add(documentId);

  try {
    const baseSnapshot = seedSnapshot || localFallback.getDocument(documentId, sessionId);
    snapshotCache.set(documentId, baseSnapshot);
    upsertSummary(optimisticSummaryFromSnapshot(baseSnapshot));
    notifySnapshotListeners(documentId, baseSnapshot, false);

    const data = await fetchJson('/api/ai-editor/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: documentId,
        title: baseSnapshot.title,
        blocks: baseSnapshot.blocks,
      }),
    });

    applyRemoteSnapshot(documentId, data, true);
    await refreshDocumentsFromBackend();
  } catch (error) {
    console.error(`Failed to bootstrap ai-editor document ${documentId}:`, error);
  } finally {
    pendingBootstrapDocuments.delete(documentId);
  }
}

async function refreshDocumentFromBackend(
  documentId: string,
  sessionId: string,
  requestedRole: AIEditorAccessRole | null,
) {
  if (!hasToken()) {
    if (!requestedRole) {
      const localSnapshot = snapshotCache.get(documentId) || localFallback.getDocument(documentId, sessionId);
      snapshotCache.set(documentId, localSnapshot);
      upsertSummary(optimisticSummaryFromSnapshot(localSnapshot));
      notifySnapshotListeners(documentId, localSnapshot, false);
    }
    return;
  }

  try {
    const data = await fetchJson(`/api/ai-editor/documents/${documentId}`);
    applyRemoteSnapshot(documentId, data, true);
    await refreshDocumentsFromBackend();
  } catch (error) {
    if (error instanceof Error && error.message === 'Document not found' && !requestedRole) {
      await bootstrapDocumentInBackend(
        documentId,
        sessionId,
        snapshotCache.get(documentId) || localFallback.getDocument(documentId, sessionId),
      );
      return;
    }
    console.error(`Failed to load ai-editor document ${documentId}:`, error);
  }
}

function optimisticSnapshotUpdate(
  documentId: string,
  updater: (current: AIEditorDocumentSnapshot) => AIEditorDocumentSnapshot,
) {
  const current = snapshotCache.get(documentId);
  if (!current) {
    return null;
  }

  const next = updater(current);
  snapshotCache.set(documentId, next);
  upsertSummary(optimisticSummaryFromSnapshot(next));
  notifySnapshotListeners(documentId, next, false);
  return next;
}

function hasSubscribers(documentId: string) {
  return Boolean(documentListeners.get(documentId)?.size || collaboratorListeners.get(documentId)?.size);
}

function sendRealtimeMessage(documentId: string, payload: Record<string, unknown>) {
  const connection = liveConnections.get(documentId);
  if (!connection || !connection.websocket || connection.websocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  connection.websocket.send(JSON.stringify(payload));
  return true;
}

function stopHeartbeat(connection: LiveConnection) {
  if (connection.heartbeatTimer) {
    window.clearInterval(connection.heartbeatTimer);
    connection.heartbeatTimer = null;
  }
}

function scheduleReconnect(connection: LiveConnection) {
  if (!connection.shouldReconnect || connection.reconnectTimer || !hasSubscribers(connection.documentId)) {
    return;
  }

  connection.reconnectTimer = window.setTimeout(() => {
    connection.reconnectTimer = null;
    openRealtimeConnection(connection.documentId);
  }, RECONNECT_DELAY_MS);
}

function openRealtimeConnection(documentId: string) {
  const connection = liveConnections.get(documentId);
  if (!connection || !hasToken()) {
    return;
  }

  if (
    connection.websocket &&
    (connection.websocket.readyState === WebSocket.OPEN ||
      connection.websocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const websocket = new WebSocket(createRealtimeUrl(documentId, connection.requestedRole));
  connection.websocket = websocket;

  websocket.onopen = () => {
    connection.consecutiveFailures = 0;
    connection.hasEverConnected = true;

    websocket.send(
      JSON.stringify({
        type: 'join',
        sessionId: connection.session.sessionId,
        displayName: connection.session.displayName,
        color: connection.session.color,
        cursor: connection.lastCursor,
      }),
    );

    stopHeartbeat(connection);
    connection.heartbeatTimer = window.setInterval(() => {
      sendRealtimeMessage(documentId, {
        type: 'presence:heartbeat',
        displayName: connection.session.displayName,
        color: connection.session.color,
        cursor: connection.lastCursor,
      });
    }, HEARTBEAT_INTERVAL_MS);
  };

  websocket.onmessage = (event: MessageEvent<string>) => {
    let message: RealtimeEnvelope | null = null;
    try {
      message = JSON.parse(event.data) as RealtimeEnvelope;
    } catch (error) {
      console.error('Failed to parse ai-editor realtime message:', error);
      return;
    }

    if (!message) {
      return;
    }

    if (message.type === 'sync:init') {
      applyRemoteSnapshot(documentId, message.snapshot, true);
      notifyCollaboratorListeners(
        documentId,
        normalizeCollaborators(message.collaborators, connection.session.sessionId),
      );
      return;
    }

    if (message.type === 'sync:document') {
      applyRemoteSnapshot(documentId, message.snapshot, true);
      return;
    }

    if (message.type === 'sync:presence') {
      notifyCollaboratorListeners(
        documentId,
        normalizeCollaborators(message.collaborators, connection.session.sessionId),
      );
      return;
    }

    if (message.type === 'error') {
      console.error('AI editor realtime error:', message.detail);
    }
  };

  websocket.onerror = () => {
    console.error(`AI editor realtime socket error for ${documentId}`);
  };

  websocket.onclose = () => {
    if (connection.websocket === websocket) {
      connection.websocket = null;
    }
    stopHeartbeat(connection);
    connection.consecutiveFailures += 1;

    if (!connection.hasEverConnected && connection.consecutiveFailures >= 3) {
      connection.shouldReconnect = false;
      return;
    }

    scheduleReconnect(connection);
  };
}

function ensureRealtimeConnection(
  documentId: string,
  session: AIEditorCollaborator,
  requestedRole: AIEditorAccessRole | null,
) {
  const existing = liveConnections.get(documentId);
  if (existing) {
    existing.session = session;
    existing.requestedRole = requestedRole ?? existing.requestedRole;
    existing.shouldReconnect = true;
    openRealtimeConnection(documentId);
    return existing;
  }

  const connection: LiveConnection = {
    documentId,
    session,
    requestedRole,
    websocket: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    shouldReconnect: true,
    lastCursor: null,
    consecutiveFailures: 0,
    hasEverConnected: false,
  };
  liveConnections.set(documentId, connection);
  openRealtimeConnection(documentId);
  return connection;
}

function closeRealtimeConnection(documentId: string) {
  const connection = liveConnections.get(documentId);
  if (!connection) {
    return;
  }

  connection.shouldReconnect = false;
  stopHeartbeat(connection);
  if (connection.reconnectTimer) {
    window.clearTimeout(connection.reconnectTimer);
  }
  if (
    connection.websocket &&
    (connection.websocket.readyState === WebSocket.OPEN ||
      connection.websocket.readyState === WebSocket.CONNECTING)
  ) {
    connection.websocket.close();
  }
  liveConnections.delete(documentId);
}

function syncDocumentViaHttp(documentId: string, body: Record<string, unknown>) {
  return fetchJson(`/api/ai-editor/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((data) => {
    applyRemoteSnapshot(documentId, data, true);
    return data;
  });
}

export function createDocsBackendProvider(): AIEditorProvider {
  return {
    getSession() {
      return localFallback.getSession();
    },

    updateSessionDisplayName(displayName) {
      const nextSession = localFallback.updateSessionDisplayName(displayName);
      liveConnections.forEach((connection) => {
        if (connection.session.sessionId === nextSession.sessionId) {
          connection.session = nextSession;
          sendRealtimeMessage(connection.documentId, {
            type: 'presence:heartbeat',
            displayName: nextSession.displayName,
            color: nextSession.color,
            cursor: connection.lastCursor,
          });
        }
      });
      return nextSession;
    },

    createDocument(sessionId) {
      if (!hasToken()) {
        return localFallback.createDocument(sessionId);
      }

      const id = crypto.randomUUID();
      const optimisticSnapshot: AIEditorDocumentSnapshot = {
        id,
        title: 'Untitled document',
        blocks: [],
        ownerSessionId: sessionId,
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
        share: {
          isLinkSharingEnabled: false,
          defaultAccessRole: 'editor',
          updatedAt: Date.now(),
        },
        members: [],
        bookmarks: [],
        comments: [],
        activity: [],
      };

      snapshotCache.set(id, optimisticSnapshot);
      upsertSummary(optimisticSummaryFromSnapshot(optimisticSnapshot));

      fetchJson('/api/ai-editor/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: optimisticSnapshot.title, blocks: optimisticSnapshot.blocks }),
      })
        .then((data) => {
          applyRemoteSnapshot(id, data, true);
        })
        .catch((error) => {
          console.error('Failed to create ai-editor document in backend:', error);
        });

      return id;
    },

    async deleteDocument(documentId, sessionId) {
      if (!hasToken()) {
        await localFallback.deleteDocument(documentId, sessionId);
        removeDocumentFromCaches(documentId);
        return;
      }

      const snapshot = snapshotCache.get(documentId);
      const isOwner =
        snapshot?.ownerSessionId === sessionId ||
        (snapshot as (AIEditorDocumentSnapshot & { currentUserRole?: AIEditorAccessRole }) | undefined)
          ?.currentUserRole === 'owner';

      if (snapshot && !isOwner) {
        throw new Error('Only the owner can delete this document');
      }

      await fetchJson(`/api/ai-editor/documents/${documentId}`, {
        method: 'DELETE',
      });
      removeDocumentFromCaches(documentId);
    },

    getDocument(documentId, ownerSessionId) {
      return snapshotCache.get(documentId) || localFallback.getDocument(documentId, ownerSessionId);
    },

    listDocuments() {
      return summaryCache;
    },

    listDocumentsSharedWith(email) {
      const normalizedEmail = email.trim().toLowerCase();
      return summaryCache.filter((document) =>
        document.memberEmails.some((memberEmail) => memberEmail === normalizedEmail),
      );
    },

    subscribeToDocuments(listener) {
      documentsListListeners.add(listener);
      listener(summaryCache);
      void refreshDocumentsFromBackend();
      return () => {
        documentsListListeners.delete(listener);
      };
    },

    subscribeToDocument({ documentId, session, requestedRole, onSnapshot, onCollaborators }: DocumentSubscriptionOptions) {
      const snapshotSubscribers = documentListeners.get(documentId) || new Set<SnapshotListener>();
      snapshotSubscribers.add(onSnapshot);
      documentListeners.set(documentId, snapshotSubscribers);

      const collaboratorSubscribers =
        collaboratorListeners.get(documentId) || new Set<CollaboratorListener>();
      collaboratorSubscribers.add(onCollaborators);
      collaboratorListeners.set(documentId, collaboratorSubscribers);

      if (!hasToken()) {
        return localFallback.subscribeToDocument({
          documentId,
          session,
          requestedRole,
          onSnapshot,
          onCollaborators,
        });
      }

      const cachedSnapshot = snapshotCache.get(documentId);
      if (cachedSnapshot) {
        onSnapshot(cachedSnapshot, { remote: false });
      }

      const cachedCollaborators = collaboratorCache.get(documentId);
      if (cachedCollaborators) {
        onCollaborators(cachedCollaborators);
      } else {
        onCollaborators([
          {
            ...session,
            role: requestedRole || 'owner',
            lastSeenAt: Date.now(),
            isCurrentUser: true,
            cursor: null,
          },
        ]);
      }

      void refreshDocumentFromBackend(documentId, session.sessionId, requestedRole).finally(() => {
        // The viewer may have left while the document was loading; opening
        // the socket then leaked a connection and its 5 s heartbeat.
        if (hasSubscribers(documentId)) {
          ensureRealtimeConnection(documentId, session, requestedRole);
        }
      });

      return () => {
        snapshotSubscribers.delete(onSnapshot);
        if (snapshotSubscribers.size === 0) {
          documentListeners.delete(documentId);
        }

        collaboratorSubscribers.delete(onCollaborators);
        if (collaboratorSubscribers.size === 0) {
          collaboratorListeners.delete(documentId);
        }

        if (!hasSubscribers(documentId)) {
          closeRealtimeConnection(documentId);
        }
      };
    },

    updateTitle(documentId, sessionId, title) {
      const baseRevision = snapshotCache.get(documentId)?.revision ?? Date.now();
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        title,
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken()) {
        const sent = sendRealtimeMessage(documentId, {
          type: 'document:update',
          baseRevision,
          title,
          cursor: liveConnections.get(documentId)?.lastCursor,
        });
        if (!sent) {
          void syncDocumentViaHttp(documentId, { title }).catch((error) =>
            console.error('Failed to update ai-editor title:', error),
          );
        }
      }

      return next || localFallback.updateTitle(documentId, sessionId, title);
    },

    updateBlocks(documentId, sessionId, blocks) {
      const baseRevision = snapshotCache.get(documentId)?.revision ?? Date.now();
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        blocks,
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken()) {
        const sent = sendRealtimeMessage(documentId, {
          type: 'document:update',
          baseRevision,
          blocks,
          cursor: liveConnections.get(documentId)?.lastCursor,
        });
        if (!sent) {
          void syncDocumentViaHttp(documentId, { blocks }).catch((error) =>
            console.error('Failed to update ai-editor blocks:', error),
          );
        }
      }

      return next || localFallback.updateBlocks(documentId, sessionId, blocks as Block<any, any, any>[]);
    },

    persistBlocks(documentId, sessionId, blocks) {
      let next: AIEditorDocumentSnapshot;
      try {
        next = optimisticSnapshotUpdate(documentId, (current) => ({
          ...current,
          blocks,
          revision: Date.now(),
          updatedAt: Date.now(),
          updatedBySessionId: sessionId,
        })) || localFallback.updateBlocks(documentId, sessionId, blocks as Block<any, any, any>[]);
      } catch (error) {
        // The browser-only save (signed-out) writes localStorage and can throw
        // synchronously (quota exceeded, storage blocked). Callers handle a
        // rejected promise; a synchronous throw escaped their timer as an
        // uncaught error on every autosave.
        return Promise.reject(error);
      }

      if (!hasToken()) {
        return Promise.resolve(next);
      }

      return syncDocumentViaHttp(documentId, { blocks }).then(() => snapshotCache.get(documentId) || next);
    },

    updateShareSettings(documentId, sessionId, nextShare) {
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        share: {
          ...current.share,
          ...nextShare,
          updatedAt: Date.now(),
        },
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken()) {
        void syncDocumentViaHttp(documentId, {
          share_settings: {
            ...(next?.share || {}),
          },
        }).catch((error) => console.error('Failed to update ai-editor share settings:', error));
      }

      return (
        next ||
        localFallback.updateShareSettings(
          documentId,
          sessionId,
          nextShare as Partial<AIEditorShareSettings>,
        )
      );
    },

    addMember(documentId, sessionId, member) {
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        members: [
          {
            id: crypto.randomUUID(),
            displayName: member.displayName,
            email: member.email,
            role: member.role,
            addedAt: Date.now(),
          },
          ...current.members.filter((entry) => entry.email.toLowerCase() !== member.email.toLowerCase()),
        ],
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken()) {
        void fetchJson(`/api/ai-editor/documents/${documentId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: member.email,
            display_name: member.displayName,
            role: member.role,
          }),
        })
          .then(() => refreshDocumentFromBackend(documentId, sessionId, null))
          .catch((error) => console.error('Failed to invite ai-editor member:', error));
      }

      return next || localFallback.addMember(documentId, sessionId, member);
    },

    updateMemberRole(documentId, sessionId, memberId, role) {
      const numericId = Number(memberId);
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        members: current.members.map((member) =>
          member.id === memberId ? { ...member, role } : member,
        ),
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken() && Number.isFinite(numericId)) {
        void fetchJson(`/api/ai-editor/documents/${documentId}/members/${numericId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        })
          .then(() => refreshDocumentFromBackend(documentId, sessionId, null))
          .catch((error) => console.error('Failed to update ai-editor member role:', error));
      }

      return next || localFallback.updateMemberRole(documentId, sessionId, memberId, role);
    },

    removeMember(documentId, sessionId, memberId) {
      const numericId = Number(memberId);
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        members: current.members.filter((member) => member.id !== memberId),
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (hasToken() && Number.isFinite(numericId)) {
        void fetchJson(`/api/ai-editor/documents/${documentId}/members/${numericId}`, {
          method: 'DELETE',
        })
          .then(() => refreshDocumentFromBackend(documentId, sessionId, null))
          .catch((error) => console.error('Failed to remove ai-editor member:', error));
      }

      return next || localFallback.removeMember(documentId, sessionId, memberId);
    },

    addComment(documentId, sessionId, comment) {
      if (!hasToken()) {
        return localFallback.addComment(documentId, sessionId, comment);
      }

      const trimmedText = comment.text.trim();
      if (!trimmedText) {
        return snapshotCache.get(documentId) || localFallback.getDocument(documentId, sessionId);
      }

      const actorDisplayName =
        collaboratorCache
          .get(documentId)
          ?.find((collaborator) => collaborator.sessionId === sessionId)
          ?.displayName || localFallback.getSession().displayName;

      const nextComment: AIEditorComment = {
        id: crypto.randomUUID(),
        actorSessionId: sessionId,
        actorDisplayName,
        text: trimmedText,
        selectedText: comment.selectedText?.trim() || undefined,
        blockId: comment.blockId ?? null,
        createdAt: Date.now(),
      };

      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        comments: [nextComment, ...(current.comments ?? [])],
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (next) {
        void syncDocumentViaHttp(documentId, { comments: next.comments }).catch((error) =>
          console.error('Failed to sync ai-editor comments:', error),
        );
      }

      return next || localFallback.addComment(documentId, sessionId, comment);
    },

    updateComments(documentId, sessionId, comments) {
      if (!hasToken()) {
        return localFallback.updateComments(documentId, sessionId, comments);
      }

      const baseRevision = snapshotCache.get(documentId)?.revision ?? Date.now();
      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        comments,
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      const sent = sendRealtimeMessage(documentId, {
        type: 'document:update',
        baseRevision,
        comments,
        cursor: liveConnections.get(documentId)?.lastCursor,
      });
      if (!sent) {
        void syncDocumentViaHttp(documentId, { comments }).catch((error) =>
          console.error('Failed to sync ai-editor comments:', error),
        );
      }

      return next || localFallback.updateComments(documentId, sessionId, comments);
    },

    addBookmark(documentId, sessionId, bookmark) {
      if (!hasToken()) {
        return localFallback.addBookmark(documentId, sessionId, bookmark);
      }

      const trimmedLabel = bookmark.label.trim();
      const blockId = bookmark.blockId.trim();
      if (!trimmedLabel || !blockId) {
        return snapshotCache.get(documentId) || localFallback.getDocument(documentId, sessionId);
      }

      const actorDisplayName =
        collaboratorCache
          .get(documentId)
          ?.find((collaborator) => collaborator.sessionId === sessionId)
          ?.displayName || localFallback.getSession().displayName;

      const nextBookmark: AIEditorBookmark = {
        id: crypto.randomUUID(),
        actorSessionId: sessionId,
        actorDisplayName,
        label: trimmedLabel,
        blockId,
        createdAt: Date.now(),
      };

      const next = optimisticSnapshotUpdate(documentId, (current) => ({
        ...current,
        bookmarks: [nextBookmark, ...(current.bookmarks ?? [])],
        revision: Date.now(),
        updatedAt: Date.now(),
        updatedBySessionId: sessionId,
      }));

      if (next) {
        void syncDocumentViaHttp(documentId, { bookmarks: next.bookmarks }).catch((error) =>
          console.error('Failed to sync ai-editor bookmarks:', error),
        );
      }

      return next || localFallback.addBookmark(documentId, sessionId, bookmark);
    },

    updateCursor(documentId, session, cursor) {
      if (!hasToken()) {
        localFallback.updateCursor(documentId, session, cursor);
        return;
      }

      const connection = ensureRealtimeConnection(documentId, session, null);
      connection.lastCursor = cursor;
      void sendRealtimeMessage(documentId, {
        type: 'cursor:update',
        displayName: session.displayName,
        color: session.color,
        cursor,
      });
    },

    getEffectiveRole(snapshot, sessionId, requestedRole, authenticatedEmail) {
      const currentUserRole = (snapshot as any).currentUserRole;
      if (currentUserRole) {
        return currentUserRole;
      }
      return localFallback.getEffectiveRole(snapshot, sessionId, requestedRole, authenticatedEmail);
    },
  };
}
