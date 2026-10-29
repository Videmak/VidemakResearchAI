'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { LuBell, LuCheck, LuEllipsisVertical, LuSearch, LuX } from 'react-icons/lu';
import type { AIEditorComment } from '../../types/ai-editor';

type AIEditorCommentsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  comments: AIEditorComment[];
  canComment: boolean;
  currentUserSessionId?: string | null;
  currentUserDisplayName?: string;
  mentionableUsers?: Array<{
    id: string;
    displayName: string;
    email?: string | null;
  }>;
  initialSelectedText?: string;
  initialBlockId?: string | null;
  activeCommentId?: string | null;
  onActiveCommentChange?: (commentId: string | null) => void;
  onAddComment: (comment: {
    text: string;
    selectedText?: string;
    blockId?: string | null;
  }) => void;
  onAddCommentReply: (commentId: string, text: string) => void;
  onUpdateComment: (commentId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onResolveComment: (commentId: string, resolved: boolean) => void;
};

type CommentTab = 'all' | 'for-you';
type CommentStatusFilter = 'all' | 'open' | 'resolved';
type CommentLocationFilter = 'all' | 'current';

function formatCommentTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'C';
}

function isResolved(comment: AIEditorComment) {
  return comment.status === 'resolved';
}

function getActiveMentionQuery(value: string) {
  const match = value.match(/(?:^|\s)@([\w.\-]*)$/);
  return match ? match[1].toLowerCase() : null;
}

function applyMention(value: string, displayName: string) {
  return value.replace(/(?:^|\s)@([\w.\-]*)$/, (match) => {
    const prefix = match.startsWith(' ') ? ' ' : '';
    return `${prefix}@${displayName} `;
  });
}

export default function AIEditorCommentsDialog({
  isOpen,
  onClose,
  comments,
  canComment,
  currentUserSessionId,
  currentUserDisplayName,
  mentionableUsers = [],
  initialSelectedText,
  initialBlockId,
  activeCommentId,
  onActiveCommentChange,
  onAddComment,
  onAddCommentReply,
  onUpdateComment,
  onDeleteComment,
  onResolveComment,
}: AIEditorCommentsDialogProps) {
  const [newCommentText, setNewCommentText] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<CommentTab>('all');
  const [statusFilter, setStatusFilter] = useState<CommentStatusFilter>('all');
  const [locationFilter, setLocationFilter] = useState<CommentLocationFilter>('all');

  useEffect(() => {
    if (!isOpen) {
      setNewCommentText('');
      setReplyDrafts((drafts) => (Object.keys(drafts).length ? {} : drafts));
      setEditingCommentId(null);
      setEditingText('');
      setOpenMenuId(null);
      setSearchQuery('');
      return;
    }

    const initialActiveId =
      activeCommentId ??
      (initialBlockId
        ? comments.find((comment) => comment.blockId === initialBlockId)?.id ?? null
        : comments[0]?.id ?? null);
    onActiveCommentChange?.(initialActiveId);
  }, [activeCommentId, comments, initialBlockId, isOpen, onActiveCommentChange]);

  const visibleComments = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return comments
      .filter((comment) => {
        if (activeTab === 'for-you') {
          const hasReplyFromOthers = (comment.replies ?? []).some(
            (reply) => reply.actorSessionId !== currentUserSessionId,
          );
          const needsAttention =
            !isResolved(comment) &&
            (comment.actorSessionId !== currentUserSessionId || hasReplyFromOthers);
          if (!needsAttention) {
            return false;
          }
        }

        if (statusFilter === 'open' && isResolved(comment)) {
          return false;
        }
        if (statusFilter === 'resolved' && !isResolved(comment)) {
          return false;
        }

        if (locationFilter === 'current' && initialBlockId && comment.blockId !== initialBlockId) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        const haystack = [
          comment.actorDisplayName,
          comment.text,
          comment.selectedText,
          ...(comment.replies ?? []).map((reply) => `${reply.actorDisplayName} ${reply.text}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (isResolved(left) !== isResolved(right)) {
          return isResolved(left) ? 1 : -1;
        }
        return right.createdAt - left.createdAt;
      });
  }, [activeTab, comments, currentUserSessionId, initialBlockId, locationFilter, searchQuery, statusFilter]);

  const activeComment =
    visibleComments.find((comment) => comment.id === activeCommentId) ??
    visibleComments[0] ??
    null;
  const newCommentMentionQuery = getActiveMentionQuery(newCommentText);
  const newCommentMentionSuggestions = useMemo(() => {
    if (newCommentMentionQuery === null) {
      return [];
    }

    return mentionableUsers
      .filter((person) => {
        const haystack = `${person.displayName} ${person.email || ''}`.toLowerCase();
        return haystack.includes(newCommentMentionQuery);
      })
      .slice(0, 5);
  }, [mentionableUsers, newCommentMentionQuery]);

  if (!isOpen) {
    return null;
  }

  const handleSubmitNewComment = () => {
    const trimmed = newCommentText.trim();
    if (!trimmed) {
      return;
    }

    onAddComment({
      text: trimmed,
      selectedText: initialSelectedText,
      blockId: initialBlockId,
    });
    setNewCommentText('');
  };

  const handleReply = (commentId: string) => {
    const trimmed = replyDrafts[commentId]?.trim();
    if (!trimmed) {
      return;
    }

    onAddCommentReply(commentId, trimmed);
    setReplyDrafts((current) => ({ ...current, [commentId]: '' }));
  };

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-[#e5e7eb] bg-[#f8fafc] ">
      <div className="flex items-center justify-between border-b border-[#e5e7eb] px-4 py-3">
        <div className="text-[20px] font-medium text-[#0f172a]">Comments</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Notification settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#64748b] transition-colors hover:bg-[#eff6ff]"
          >
            <LuBell className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#64748b] transition-colors hover:bg-[#eff6ff]"
          >
            <LuX className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="border-b border-[#e5e7eb] px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`border-b-2 pb-2 text-[14px] transition-colors ${
                activeTab === 'all'
                  ? 'border-[var(--theme-primary)] font-medium text-[var(--theme-primary)]'
                  : 'border-transparent text-[#334155]'
              }`}
            >
              All comments
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('for-you')}
              className={`border-b-2 pb-2 text-[14px] transition-colors ${
                activeTab === 'for-you'
                  ? 'border-[var(--theme-primary)] font-medium text-[var(--theme-primary)]'
                  : 'border-transparent text-[#334155]'
              }`}
            >
              For you
            </button>
          </div>
          <div className="relative">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search comments"
              className="h-9 w-[148px] rounded-full border border-[#e5e7eb] bg-white pl-9 pr-3 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 pb-3">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CommentStatusFilter)}
            className="h-9 rounded-xl border border-[#cbd5e1] bg-white px-3 text-[13px] text-[#334155] outline-none"
          >
            <option value="all">All types</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value as CommentLocationFilter)}
            className="h-9 rounded-xl border border-[#cbd5e1] bg-white px-3 text-[13px] text-[#334155] outline-none"
          >
            <option value="all">All tabs</option>
            <option value="current">This tab</option>
          </select>
        </div>
      </div>

      {canComment && (initialSelectedText || initialBlockId) ? (
        <div className="border-b border-[#e5e7eb] bg-white px-4 py-3">
          {initialSelectedText ? (
            <div className="mb-2 line-clamp-2 rounded-xl bg-[#f1f5f9] px-3 py-2 text-[12px] text-[#64748b]">
              {initialSelectedText}
            </div>
          ) : null}
          <div className="relative">
            <textarea
              value={newCommentText}
              onChange={(event) => setNewCommentText(event.target.value)}
              placeholder={`Comment as ${currentUserDisplayName || 'you'}`}
              className="min-h-[72px] w-full resize-none rounded-[14px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
            />
            {newCommentMentionSuggestions.length > 0 ? (
              <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                {newCommentMentionSuggestions.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => setNewCommentText((current) => applyMention(current, person.displayName))}
                    className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[#f8fafc]"
                  >
                    <span className="text-[13px] text-[#0f172a]">{person.displayName}</span>
                    <span className="truncate pl-3 text-[11px] text-[#64748b]">{person.email || ''}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={handleSubmitNewComment}
              disabled={!newCommentText.trim()}
              className="inline-flex h-8 items-center justify-center rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#cbd5e1]"
            >
              Comment
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {visibleComments.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[#e5e7eb] bg-white px-4 py-8 text-center text-[13px] text-[#64748b]">
            No matching comments yet.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleComments.map((comment) => {
              const selected = comment.id === activeComment?.id;
              const canManage =
                comment.actorSessionId === currentUserSessionId || currentUserSessionId === null;
              const replies = comment.replies ?? [];
              const replyMentionQuery = getActiveMentionQuery(replyDrafts[comment.id] ?? '');
              const replyMentionSuggestions =
                replyMentionQuery === null
                  ? []
                  : mentionableUsers
                      .filter((person) =>
                        `${person.displayName} ${person.email || ''}`
                          .toLowerCase()
                          .includes(replyMentionQuery),
                      )
                      .slice(0, 5);

              return (
                <div
                  key={comment.id}
                  className={`overflow-hidden rounded-[14px] border bg-white  ${
                    selected ? 'border-[var(--theme-primary-border)] ring-1 ring-[var(--theme-primary-ring)]' : 'border-[#e5e7eb]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onActiveCommentChange?.(comment.id)}
                    className="block w-full text-left"
                  >
                    <div className="border-b border-[#f1f5f9] bg-[#f8fafc] px-4 py-2">
                      <div className="truncate text-[12px] font-medium text-[#334155]">
                        {comment.selectedText || 'Comment location'}
                      </div>
                    </div>
                  </button>

                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary-ring)] text-[10px] font-semibold text-[var(--theme-primary-dark)]">
                          {getInitials(comment.actorDisplayName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-[#0f172a]">
                            {comment.actorDisplayName}
                          </div>
                          <div className="text-[11px] text-[#64748b]">{formatCommentTime(comment.createdAt)}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onResolveComment(comment.id, !isResolved(comment))}
                          aria-label={isResolved(comment) ? 'Reopen thread' : 'Resolve thread'}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                            isResolved(comment)
                              ? 'bg-[#dcfce7] text-[#16a34a]'
                              : 'text-[#64748b] hover:bg-[#eff6ff]'
                          }`}
                        >
                          <LuCheck className="h-5 w-5" />
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setOpenMenuId((current) => (current === comment.id ? null : comment.id))}
                            aria-label="More options"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#64748b] transition-colors hover:bg-[#eff6ff]"
                          >
                            <LuEllipsisVertical className="h-5 w-5" />
                          </button>
                          {openMenuId === comment.id ? (
                            <div className="absolute right-0 top-9 z-10 min-w-[180px] overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCommentId(comment.id);
                                    setEditingText(comment.text);
                                    setOpenMenuId(null);
                                  }}
                                  className="flex w-full items-center px-4 py-2 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                                >
                                  Edit
                                </button>
                              ) : null}
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteComment(comment.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="flex w-full items-center px-4 py-2 text-left text-[13px] text-[#b91c1c] transition-colors hover:bg-[#fef2f2]"
                                >
                                  Delete
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  const url = new URL(window.location.href);
                                  url.searchParams.set('comment', comment.id);
                                  // Clipboard writes reject when the browser denies
                                  // permission; that must not become an unhandled rejection.
                                  void navigator.clipboard?.writeText(url.toString()).catch((error) => {
                                    console.error('Failed to copy ai-editor comment link:', error);
                                  });
                                  setOpenMenuId(null);
                                }}
                                className="flex w-full items-center px-4 py-2 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                              >
                                Get link to this comment
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {editingCommentId === comment.id ? (
                      <div className="mt-3">
                        <textarea
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          className="min-h-[72px] w-full resize-none rounded-[14px] border border-[#e5e7eb] px-3 py-2.5 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditingText('');
                            }}
                            className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12px] text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateComment(comment.id, editingText);
                              setEditingCommentId(null);
                              setEditingText('');
                            }}
                            disabled={!editingText.trim()}
                            className="inline-flex h-8 items-center justify-center rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#cbd5e1]"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 whitespace-pre-wrap text-[14px] text-[#0f172a]">{comment.text}</div>
                    )}

                    {replies.length > 0 ? (
                      <div className="mt-3 space-y-2 border-t border-[#f1f5f9] pt-3">
                        {replies.map((reply) => (
                          <div key={reply.id} className="rounded-xl bg-[#f8fafc] px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-medium text-[#0f172a]">
                                {reply.actorDisplayName}
                              </span>
                              <span className="text-[11px] text-[#94a3b8]">
                                {formatCommentTime(reply.createdAt)}
                              </span>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-[13px] text-[#0f172a]">
                              {reply.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {selected && canComment ? (
                      <div className="mt-3 border-t border-[#f1f5f9] pt-3">
                        <div className="flex items-start gap-2">
                          <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary-soft)] text-[10px] font-semibold text-[var(--theme-primary-dark)]">
                            {getInitials(currentUserDisplayName || 'You')}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="relative">
                              <input
                                value={replyDrafts[comment.id] ?? ''}
                                onChange={(event) =>
                                  setReplyDrafts((current) => ({
                                    ...current,
                                    [comment.id]: event.target.value,
                                  }))
                                }
                                placeholder="Reply or add others with @"
                                className="h-10 w-full rounded-full border border-[#e5e7eb] bg-white px-4 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
                              />
                              {replyMentionSuggestions.length > 0 ? (
                                <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                                  {replyMentionSuggestions.map((person) => (
                                    <button
                                      key={person.id}
                                      type="button"
                                      onClick={() =>
                                        setReplyDrafts((current) => ({
                                          ...current,
                                          [comment.id]: applyMention(current[comment.id] ?? '', person.displayName),
                                        }))
                                      }
                                      className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[#f8fafc]"
                                    >
                                      <span className="text-[13px] text-[#0f172a]">{person.displayName}</span>
                                      <span className="truncate pl-3 text-[11px] text-[#64748b]">
                                        {person.email || ''}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setReplyDrafts((current) => ({ ...current, [comment.id]: '' }))}
                                className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12px] text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReply(comment.id)}
                                disabled={!replyDrafts[comment.id]?.trim()}
                                className="inline-flex h-8 items-center justify-center rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#cbd5e1]"
                              >
                                Reply
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isResolved(comment) ? (
                      <div className="mt-2 text-[11px] text-[#16a34a]">
                        Resolved{comment.resolvedByDisplayName ? ` by ${comment.resolvedByDisplayName}` : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeComment ? (
        <div className="border-t border-[#e5e7eb] bg-white px-4 py-3 text-[11px] text-[#64748b]">
          Active thread: <span className="font-medium text-[#0f172a]">{activeComment.actorDisplayName}</span>
        </div>
      ) : null}
    </aside>
  );
}
