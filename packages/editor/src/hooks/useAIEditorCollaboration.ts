'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@blocknote/core';
import { getAIEditorProvider } from '../lib/aiEditor/getProvider';
import type {
  AIEditorAccessRole,
  AIEditorActivityEntry,
  AIEditorBookmark,
  AIEditorComment,
  AIEditorReviewCommentInput,
  AIEditorCollaborator,
  AIEditorCursorState,
  AIEditorDocumentMember,
  AIEditorDocumentSnapshot,
  AIEditorSaveState,
  AIEditorShareSettings,
} from '../types/ai-editor';

const EMPTY_MEMBERS: AIEditorDocumentMember[] = [];
export const AI_COMMENT_AUTHOR = 'Videmak AI';
export const AI_COMMENT_SESSION_ID = 'citedevidence-ai';
const EMPTY_BOOKMARKS: AIEditorBookmark[] = [];
const EMPTY_COMMENTS: AIEditorComment[] = [];
const EMPTY_ACTIVITY: AIEditorActivityEntry[] = [];
function normalizeComments(raw: unknown): AIEditorComment[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item): AIEditorComment => {
      const status: AIEditorComment['status'] = item.status === 'resolved' ? 'resolved' : 'open';
      return {
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        actorSessionId: typeof item.actorSessionId === 'string' ? item.actorSessionId : '',
        actorDisplayName:
          typeof item.actorDisplayName === 'string' && item.actorDisplayName.trim()
            ? item.actorDisplayName
            : 'Collaborator',
        text: typeof item.text === 'string' ? item.text : '',
        selectedText: typeof item.selectedText === 'string' ? item.selectedText : undefined,
        blockId: typeof item.blockId === 'string' ? item.blockId : null,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
        status,
        resolvedAt: typeof item.resolvedAt === 'number' ? item.resolvedAt : null,
        resolvedBySessionId:
          typeof item.resolvedBySessionId === 'string' ? item.resolvedBySessionId : null,
        resolvedByDisplayName:
          typeof item.resolvedByDisplayName === 'string' ? item.resolvedByDisplayName : null,
        ...(item.kind === 'ai-review'
          ? {
              kind: 'ai-review' as const,
              severity: item.severity === 'major' ? ('major' as const) : ('minor' as const),
              category: typeof item.category === 'string' ? item.category : undefined,
              suggestion: typeof item.suggestion === 'string' ? item.suggestion : null,
              ...(typeof item.check === 'string' ? { check: item.check } : {}),
            }
          : {}),
        feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : null,
        replies: Array.isArray(item.replies)
          ? item.replies
              .filter((reply): reply is Record<string, unknown> => Boolean(reply) && typeof reply === 'object')
              .map((reply) => ({
                id: typeof reply.id === 'string' ? reply.id : crypto.randomUUID(),
                actorSessionId: typeof reply.actorSessionId === 'string' ? reply.actorSessionId : '',
                actorDisplayName:
                  typeof reply.actorDisplayName === 'string' && reply.actorDisplayName.trim()
                    ? reply.actorDisplayName
                    : 'Collaborator',
                text: typeof reply.text === 'string' ? reply.text : '',
                createdAt: typeof reply.createdAt === 'number' ? reply.createdAt : Date.now(),
                updatedAt: typeof reply.updatedAt === 'number' ? reply.updatedAt : undefined,
                ...(reply.ai === true ? { ai: true } : {}),
              }))
          : [],
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

type UseAIEditorCollaborationResult = {
  session: AIEditorCollaborator | null;
  collaborators: AIEditorCollaborator[];
  members: AIEditorDocumentMember[];
  bookmarks: AIEditorBookmark[];
  comments: AIEditorComment[];
  activity: AIEditorActivityEntry[];
  documentSnapshot: AIEditorDocumentSnapshot | null;
  effectiveRole: AIEditorAccessRole;
  saveState: AIEditorSaveState;
  connectionLabel: string;
  remoteContentVersion: number;
  updateTitle: (title: string) => void;
  updateBlocks: (blocks: Block<any, any, any>[]) => void;
  flushBlocks: (blocks: Block<any, any, any>[]) => Promise<number>;
  updateCursor: (cursor: AIEditorCursorState | null) => void;
  updateShareSettings: (nextShare: Partial<AIEditorShareSettings>) => void;
  updateSessionDisplayName: (displayName: string) => void;
  addMember: (member: Omit<AIEditorDocumentMember, 'id' | 'addedAt'>) => void;
  addComment: (comment: {
    text: string;
    selectedText?: string;
    blockId?: string | null;
  }) => void;
  addCommentReply: (commentId: string, text: string) => void;
  updateComment: (commentId: string, text: string) => void;
  deleteComment: (commentId: string) => void;
  resolveComment: (commentId: string, resolved: boolean) => void;
  addAIReviewComments: (items: AIEditorReviewCommentInput[]) => number;
  addAIReply: (commentId: string, text: string) => void;
  setCommentFeedback: (commentId: string, feedback: 'up' | 'down' | null) => void;
  addBookmark: (bookmark: {
    label: string;
    blockId: string;
  }) => void;
  updateMemberRole: (
    memberId: string,
    role: Exclude<AIEditorAccessRole, 'owner'>,
  ) => void;
  removeMember: (memberId: string) => void;
};

function canEdit(role: AIEditorAccessRole) {
  return role === 'owner' || role === 'editor';
}

function canComment(role: AIEditorAccessRole) {
  return role === 'owner' || role === 'editor' || role === 'commenter';
}

export function useAIEditorCollaboration(
  documentId: string | null,
  requestedRole: AIEditorAccessRole | null,
  authenticatedEmail?: string | null,
): UseAIEditorCollaborationResult {
  const provider = getAIEditorProvider();
  const [session, setSession] = useState<AIEditorCollaborator | null>(null);
  const [documentSnapshot, setDocumentSnapshot] = useState<AIEditorDocumentSnapshot | null>(null);
  const documentSnapshotRef = useRef<AIEditorDocumentSnapshot | null>(null);
  documentSnapshotRef.current = documentSnapshot;
  const [saveState, setSaveState] = useState<AIEditorSaveState>('loading');
  const [remoteContentVersion, setRemoteContentVersion] = useState(0);
  const [collaborators, setCollaborators] = useState<AIEditorCollaborator[]>([]);
  const saveTimeoutRef = useRef<number | null>(null);

  const effectiveRole = useMemo(() => {
    if (!session || !documentSnapshot) {
      return 'owner';
    }

    return provider.getEffectiveRole(documentSnapshot, session.sessionId, requestedRole, authenticatedEmail);
  }, [authenticatedEmail, documentSnapshot, provider, requestedRole, session]);

  const connectionLabel = useMemo(() => {
    if (!documentSnapshot) {
      return 'Loading document...';
    }

    if (saveState === 'saving') {
      return 'Saving to server...';
    }

    if (saveState === 'syncing') {
      return 'Synced from collaborator';
    }

    if (saveState === 'error') {
      return 'Save failed — retrying on the next edit';
    }

    return 'Saved to server';
  }, [documentSnapshot, saveState]);

  const applyCommentsUpdate = useCallback(
    (updater: (current: AIEditorComment[]) => AIEditorComment[]) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      // The latest copy, not the one this callback closed over: AI checks add comments after a
      // slow request, and building on an old list would quietly undo changes made meanwhile.
      const latest = documentSnapshotRef.current ?? documentSnapshot;
      const nextComments = normalizeComments(updater(latest.comments ?? []));
      const next = provider.updateComments(latest.id, session.sessionId, nextComments);
      documentSnapshotRef.current = next;
      setDocumentSnapshot(next);
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const updateTitle = useCallback(
    (title: string) => {
      if (!session || !documentSnapshot || !canEdit(effectiveRole)) {
        return;
      }

      setDocumentSnapshot(provider.updateTitle(documentSnapshot.id, session.sessionId, title));
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const updateBlocks = useCallback(
    (blocks: Block<any, any, any>[]) => {
      if (!session || !documentSnapshot || !canEdit(effectiveRole)) {
        return;
      }

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      setSaveState('saving');
      saveTimeoutRef.current = window.setTimeout(() => {
        void provider.persistBlocks(documentSnapshot.id, session.sessionId, blocks)
          .then((snapshot) => {
            setDocumentSnapshot(snapshot);
            setSaveState('saved');
          })
          .catch((saveError) => {
            console.error('Failed to persist AI Editor blocks:', saveError);
            setSaveState('error');
          });
      }, 250);
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const flushBlocks = useCallback(
    async (blocks: Block<any, any, any>[]): Promise<number> => {
      if (!session || !documentSnapshot || !canEdit(effectiveRole)) {
        throw new Error('Editor access is required to save this suggestion.');
      }
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setSaveState('saving');
      try {
        const snapshot = await provider.persistBlocks(documentSnapshot.id, session.sessionId, blocks);
        setDocumentSnapshot(snapshot);
        setSaveState('saved');
        return snapshot.revision;
      } catch (saveError) {
        setSaveState('error');
        throw saveError;
      }
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const updateShareSettings = useCallback(
    (nextShare: Partial<AIEditorShareSettings>) => {
      if (!session || !documentSnapshot || effectiveRole !== 'owner') {
        return;
      }

      setDocumentSnapshot(provider.updateShareSettings(documentSnapshot.id, session.sessionId, nextShare));
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const updateCursor = useCallback(
    (cursor: AIEditorCursorState | null) => {
      if (!session || !documentSnapshot) {
        return;
      }

      provider.updateCursor(documentSnapshot.id, session, cursor);
    },
    [documentSnapshot, provider, session],
  );

  const updateSessionDisplayName = useCallback(
    (displayName: string) => {
      const trimmedDisplayName = displayName.trim();
      if (!trimmedDisplayName) {
        return;
      }

      setSession(provider.updateSessionDisplayName(trimmedDisplayName));
    },
    [provider],
  );

  const addMember = useCallback(
    (member: Omit<AIEditorDocumentMember, 'id' | 'addedAt'>) => {
      if (!session || !documentSnapshot || effectiveRole !== 'owner') {
        return;
      }

      setDocumentSnapshot(provider.addMember(documentSnapshot.id, session.sessionId, member));
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const addComment = useCallback(
    (comment: {
      text: string;
      selectedText?: string;
      blockId?: string | null;
    }) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      const trimmedText = comment.text.trim();
      if (!trimmedText) {
        return;
      }

      applyCommentsUpdate((current) => [
        {
          id: crypto.randomUUID(),
          actorSessionId: session.sessionId,
          actorDisplayName: session.displayName,
          text: trimmedText,
          selectedText: comment.selectedText?.trim() || undefined,
          blockId: comment.blockId ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'open',
          replies: [],
        },
        ...current,
      ]);
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const addCommentReply = useCallback(
    (commentId: string, text: string) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      applyCommentsUpdate((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                status: 'open',
                resolvedAt: null,
                resolvedBySessionId: null,
                resolvedByDisplayName: null,
                updatedAt: Date.now(),
                replies: [
                  ...(comment.replies ?? []),
                  {
                    id: crypto.randomUUID(),
                    actorSessionId: session.sessionId,
                    actorDisplayName: session.displayName,
                    text: trimmedText,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  },
                ],
              }
            : comment,
        ),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const updateComment = useCallback(
    (commentId: string, text: string) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      applyCommentsUpdate((current) =>
        current.map((comment) =>
          comment.id === commentId &&
          (comment.actorSessionId === session.sessionId || effectiveRole === 'owner')
            ? {
                ...comment,
                text: trimmedText,
                updatedAt: Date.now(),
              }
            : comment,
        ),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      applyCommentsUpdate((current) =>
        current.filter(
          (comment) =>
            comment.id !== commentId ||
            !(
              comment.actorSessionId === session.sessionId ||
              effectiveRole === 'owner' ||
              comment.kind === 'ai-review'
            ),
        ),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  // AI review comments. Already-open comments on the same text are not repeated.
  const addAIReviewComments = useCallback(
    (items: AIEditorReviewCommentInput[]) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole) || items.length === 0) {
        return 0;
      }
      let added = 0;
      applyCommentsUpdate((current) => {
        const open = new Set(
          current
            .filter((comment) => comment.kind === 'ai-review' && comment.status !== 'resolved')
            .map((comment) => `${comment.check ?? ''}\u0000${comment.blockId}\u0000${comment.selectedText}`),
        );
        const now = Date.now();
        const next = items
          // Each check keeps its own suggestions, so Proofread may comment on words Claim check flagged.
          .filter((item) => !open.has(`${item.check ?? ''}\u0000${item.blockId}\u0000${item.quote}`))
          .map((item, index): AIEditorComment => ({
            id: crypto.randomUUID(),
            actorSessionId: AI_COMMENT_SESSION_ID,
            actorDisplayName: AI_COMMENT_AUTHOR,
            text: item.comment,
            selectedText: item.quote,
            blockId: item.blockId,
            createdAt: now - index,
            updatedAt: now,
            status: 'open',
            replies: [],
            kind: 'ai-review',
            severity: item.severity,
            category: item.category,
            suggestion: item.suggestion ?? null,
            feedback: null,
            ...(item.check ? { check: item.check } : {}),
          }));
        added = next.length;
        return next.length ? [...next, ...current] : current;
      });
      return added;
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const addAIReply = useCallback(
    (commentId: string, text: string) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole) || !text.trim()) {
        return;
      }
      applyCommentsUpdate((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                updatedAt: Date.now(),
                replies: [
                  ...(comment.replies ?? []),
                  {
                    id: crypto.randomUUID(),
                    actorSessionId: AI_COMMENT_SESSION_ID,
                    actorDisplayName: AI_COMMENT_AUTHOR,
                    text: text.trim(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    ai: true,
                  },
                ],
              }
            : comment,
        ),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const setCommentFeedback = useCallback(
    (commentId: string, feedback: 'up' | 'down' | null) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }
      applyCommentsUpdate((current) =>
        current.map((comment) => (comment.id === commentId ? { ...comment, feedback } : comment)),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const resolveComment = useCallback(
    (commentId: string, resolved: boolean) => {
      if (!session || !documentSnapshot || !canComment(effectiveRole)) {
        return;
      }

      applyCommentsUpdate((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                status: resolved ? 'resolved' : 'open',
                resolvedAt: resolved ? Date.now() : null,
                resolvedBySessionId: resolved ? session.sessionId : null,
                resolvedByDisplayName: resolved ? session.displayName : null,
                updatedAt: Date.now(),
              }
            : comment,
        ),
      );
    },
    [applyCommentsUpdate, documentSnapshot, effectiveRole, session],
  );

  const addBookmark = useCallback(
    (bookmark: {
      label: string;
      blockId: string;
    }) => {
      if (!session || !documentSnapshot || !canEdit(effectiveRole)) {
        return;
      }

      setDocumentSnapshot(provider.addBookmark(documentSnapshot.id, session.sessionId, bookmark));
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const updateMemberRole = useCallback(
    (memberId: string, role: Exclude<AIEditorAccessRole, 'owner'>) => {
      if (!session || !documentSnapshot || effectiveRole !== 'owner') {
        return;
      }

      setDocumentSnapshot(
        provider.updateMemberRole(documentSnapshot.id, session.sessionId, memberId, role),
      );
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  const removeMember = useCallback(
    (memberId: string) => {
      if (!session || !documentSnapshot || effectiveRole !== 'owner') {
        return;
      }

      setDocumentSnapshot(provider.removeMember(documentSnapshot.id, session.sessionId, memberId));
      setSaveState('saved');
    },
    [documentSnapshot, effectiveRole, provider, session],
  );

  useEffect(() => {
    if (!documentId) {
      setDocumentSnapshot(null);
      setSession(null);
      setCollaborators([]);
      setSaveState('loading');
      return;
    }

    const nextSession = provider.getSession();
    setSession((prev) => {
      if (
        prev &&
        prev.sessionId === nextSession.sessionId &&
        prev.displayName === nextSession.displayName &&
        prev.color === nextSession.color
      ) {
        return prev;
      }
      return nextSession;
    });
    setSaveState('saved');

    const unsubscribe = provider.subscribeToDocument({
      documentId,
      session: nextSession,
      requestedRole,
      onSnapshot: (snapshot, meta) => {
        setDocumentSnapshot(snapshot);
        if (meta.remote) {
          setRemoteContentVersion((version) => version + 1);
          setSaveState('syncing');
        }
      },
      onCollaborators: (next) => {
        setCollaborators((prev) => {
          if (
            prev.length === next.length &&
            prev.every(
              (c, i) =>
                c.sessionId === next[i].sessionId &&
                c.displayName === next[i].displayName &&
                c.color === next[i].color &&
                c.cursor?.blockId === next[i].cursor?.blockId &&
                c.cursor?.updatedAt === next[i].cursor?.updatedAt,
            )
          ) {
            return prev;
          }
          return next;
        });
      },
    });

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      unsubscribe();
    };
  }, [documentId, provider, requestedRole]);

  useEffect(() => {
    if (saveState !== 'syncing') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSaveState('saved');
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [saveState]);

  // A fresh array each render re-ran every comment effect (anchor measuring
  // included) on every render, which fed React's nested-update limit (#185).
  const comments = useMemo(
    () => normalizeComments(documentSnapshot?.comments ?? EMPTY_COMMENTS),
    [documentSnapshot?.comments],
  );

  return {
    session,
    collaborators,
    members: documentSnapshot?.members ?? EMPTY_MEMBERS,
    bookmarks: documentSnapshot?.bookmarks ?? EMPTY_BOOKMARKS,
    comments,
    activity: documentSnapshot?.activity ?? EMPTY_ACTIVITY,
    documentSnapshot,
    effectiveRole,
    saveState,
    connectionLabel,
    remoteContentVersion,
    updateTitle,
    updateBlocks,
    flushBlocks,
    updateCursor,
    updateShareSettings,
    updateSessionDisplayName,
    addMember,
    addComment,
    addCommentReply,
    updateComment,
    deleteComment,
    resolveComment,
    addAIReviewComments,
    addAIReply,
    setCommentFeedback,
    addBookmark,
    updateMemberRole,
    removeMember,
  };
}
