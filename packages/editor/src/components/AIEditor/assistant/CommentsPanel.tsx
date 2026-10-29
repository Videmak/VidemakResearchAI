'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { LuArrowUp, LuCheck, LuEllipsis, LuMessageSquare, LuQuote, LuSearch, LuSlidersHorizontal, LuSparkles, LuThumbsDown, LuThumbsUp, LuX } from 'react-icons/lu';
import CreditsUpsell from './CreditsUpsell';
import type { AIEditorComment } from '../../../types/ai-editor';
import { CATEGORY_LABELS, type CommentFilter } from './reviewChecks';

const CHECK_TITLES: Record<string, string> = { claims: 'Claim check', proofread: 'Proofread', tone: 'Tone of voice' };

export const REVIEW_FOCUS_OPTIONS: { label: string; focus?: string }[] = [
  { label: 'Whole document' },
  { label: 'Arguments & evidence', focus: 'the strength of the arguments, unsupported claims and missing evidence' },
  { label: 'Citations', focus: 'claims that need citations and citations that look misused' },
  { label: 'Clarity & style', focus: 'clarity, concision, flow and academic style' },
  { label: 'Grammar only', focus: 'grammar, spelling and punctuation errors only' },
];

type Props = {
  comments: AIEditorComment[];
  canComment: boolean;
  currentUserSessionId?: string | null;
  currentUserDisplayName?: string;
  mentionableUsers?: Array<{ id: string; displayName: string; email?: string | null }>;
  initialSelectedText?: string;
  initialBlockId?: string | null;
  activeCommentId?: string | null;
  onActiveCommentChange?: (commentId: string | null) => void;
  /** Block order of the document, for "sort by position". */
  blockOrder: Map<string, number>;
  onAddComment: (comment: { text: string; selectedText?: string; blockId?: string | null }) => void;
  onAddCommentReply: (commentId: string, text: string) => void;
  onUpdateComment: (commentId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onResolveComment: (commentId: string, resolved: boolean) => void;
  onFeedback: (commentId: string, feedback: 'up' | 'down' | null) => void;
  onAcceptSuggestion: (comment: AIEditorComment) => void;
  onAskAI: (comment: AIEditorComment, question: string) => Promise<void>;
  onRunReview: (focus?: string) => void;
  /** Optional: opens Find papers for the passage an AI comment points at. */
  onFindSource?: (comment: AIEditorComment) => void;
  /** Set by the Review panel: show one check's suggestions (optionally one category). */
  filter?: CommentFilter;
  onClearFilter?: () => void;
  review: { running: boolean; error: string | null; outOfCredits: boolean; lastAdded: number | null };
  onDismissReviewNotice: () => void;
  isMobile?: boolean;
};

type StatusFilter = 'open' | 'resolved' | 'all';
type AuthorFilter = 'all' | 'ai' | 'people';
type SeverityFilter = 'all' | 'major' | 'minor';

const isResolved = (comment: AIEditorComment) => comment.status === 'resolved';
const isAI = (comment: AIEditorComment) => comment.kind === 'ai-review';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'C';
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "2 min", "1 h", "Oct 24", as in the mockup. */
function relativeTime(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  if (hours < 24 * 7) return `${Math.floor(hours / 24)} d`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const PERSON_COLOURS = ['#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#6366f1'];
function personColour(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PERSON_COLOURS[hash % PERSON_COLOURS.length];
}

const ACTION = 'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_PRIMARY = 'inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--theme-primary,#2563eb)] px-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50';
const ICON_BUTTON = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]';
const MENU_ITEM = 'flex w-full items-center justify-between rounded-[8px] px-2.5 py-[7px] text-left text-[13.5px] hover:bg-[#f8fafc] disabled:opacity-50';
const MENU_LABEL = 'px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-[#94a3b8]';

function Chip<T extends string>({ value, current, onChange, children }: { value: T; current: T; onChange: (value: T) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={current === value}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] transition-colors ${
        current === value ? 'bg-[#f1f5f9] font-semibold text-[#0f172a]' : 'font-medium text-[#64748b] hover:text-[#0f172a]'
      }`}
    >
      {children}
    </button>
  );
}

function Avatar({ ai, name }: { ai: boolean; name: string }) {
  return ai ? (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[var(--theme-primary,#2563eb)] text-white" aria-hidden="true">
      <LuSparkles className="h-3 w-3" />
    </span>
  ) : (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: personColour(name) }} aria-hidden="true">
      {initials(name).slice(0, 1)}
    </span>
  );
}

/** Comments beside the document, with Videmak AI review comments (Minor / Major). */
export default function CommentsPanel(props: Props) {
  const {
    comments,
    canComment,
    currentUserSessionId,
    currentUserDisplayName,
    initialSelectedText,
    initialBlockId,
    activeCommentId,
    onActiveCommentChange,
    blockOrder,
    review,
  } = props;
  const [status, setStatus] = useState<StatusFilter>('open');
  const [author, setAuthor] = useState<AuthorFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [sort, setSort] = useState<'position' | 'newest'>('position');
  const [search, setSearch] = useState('');
  const [newText, setNewText] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [reviewMenu, setReviewMenu] = useState(false);

  useEffect(() => {
    setNewText('');
  }, [initialBlockId, initialSelectedText]);

  const counts = useMemo(() => {
    const open = comments.filter((comment) => !isResolved(comment));
    return {
      all: open.length,
      ai: open.filter((comment) => isAI(comment)).length,
      people: open.filter((comment) => !isAI(comment)).length,
      open: open.length,
      major: open.filter((comment) => isAI(comment) && comment.severity === 'major').length,
      minor: open.filter((comment) => isAI(comment) && comment.severity !== 'major').length,
    };
  }, [comments]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return comments
      .filter((comment) => (status === 'all' ? true : status === 'open' ? !isResolved(comment) : isResolved(comment)))
      .filter((comment) => (author === 'all' ? true : author === 'ai' ? isAI(comment) : !isAI(comment)))
      .filter((comment) => (severity === 'all' ? true : isAI(comment) && (comment.severity === 'major') === (severity === 'major')))
      .filter((comment) => !props.filter || (comment.check === props.filter.check && (!props.filter.category || comment.category === props.filter.category)))
      .filter((comment) => {
        if (!query) return true;
        return [comment.actorDisplayName, comment.text, comment.selectedText, ...(comment.replies || []).map((reply) => reply.text)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => {
        if (sort === 'newest') return right.createdAt - left.createdAt;
        const a = blockOrder.get(left.blockId || '') ?? Number.MAX_SAFE_INTEGER;
        const b = blockOrder.get(right.blockId || '') ?? Number.MAX_SAFE_INTEGER;
        return a - b || left.createdAt - right.createdAt;
      });
  }, [author, blockOrder, comments, props.filter, search, severity, sort, status]);

  const submitReply = async (comment: AIEditorComment) => {
    const text = replyDrafts[comment.id]?.trim();
    if (!text) return;
    props.onAddCommentReply(comment.id, text);
    setReplyDrafts((current) => ({ ...current, [comment.id]: '' }));
    if (isAI(comment) || /@((citedevidence|videmak)\s*)?ai\b/i.test(text)) {
      setAsking(comment.id);
      try {
        await props.onAskAI(comment, text);
      } finally {
        setAsking(null);
      }
    }
  };


  const notice = review.error
    ? { tone: 'text-[#b91c1c]', text: review.error }
    : review.lastAdded !== null && !review.running
      ? { tone: 'text-[#15803d]', text: review.lastAdded ? `${review.lastAdded} new comment${review.lastAdded === 1 ? '' : 's'}` : 'Nothing new to point out' }
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="px-3 pb-1 pt-2.5">
        <div className="flex items-center gap-0.5">
          <Chip value="all" current={author} onChange={(value) => { setAuthor(value); setSeverity('all'); }}>All <span className="text-[#94a3b8]">{counts.all}</span></Chip>
          <Chip value="ai" current={author} onChange={setAuthor}>AI <span className="text-[#94a3b8]">{counts.ai}</span></Chip>
          <Chip value="people" current={author} onChange={(value) => { setAuthor(value); setSeverity('all'); }}>People <span className="text-[#94a3b8]">{counts.people}</span></Chip>
          <div className="ml-auto flex items-center">
            {comments.length ? (
              <button type="button" aria-label="Search comments" aria-pressed={searchOpen} onClick={() => { setSearchOpen((value) => !value); setSearch(''); }} className={ICON_BUTTON}>
                <LuSearch className="h-4 w-4" />
              </button>
            ) : null}
            <div className="relative">
              <button type="button" aria-label="Comment options" aria-expanded={reviewMenu} onClick={() => setReviewMenu((value) => !value)} className={`${ICON_BUTTON} ${reviewMenu || status !== 'open' || severity !== 'all' ? 'bg-[#f1f5f9] text-[#0f172a]' : ''}`}>
                <LuSlidersHorizontal className="h-4 w-4" />
              </button>
              {reviewMenu ? (
                <div className="absolute right-0 top-9 z-20 w-[220px] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                  <div className={MENU_LABEL}>Show</div>
                  {([['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`${MENU_ITEM} ${status === value ? 'font-semibold text-[#1d4ed8]' : 'text-[#0f172a]'}`}>
                      {label}{status === value ? <LuCheck className="h-4 w-4" /> : null}
                    </button>
                  ))}
                  {author === 'ai' ? (
                    <>
                      <div className={MENU_LABEL}>Severity</div>
                      {([['all', 'Any'], ['major', 'Major'], ['minor', 'Minor']] as const).map(([value, label]) => (
                        <button key={value} type="button" aria-pressed={severity === value} onClick={() => setSeverity(value)} className={`${MENU_ITEM} ${severity === value ? 'font-semibold text-[#1d4ed8]' : 'text-[#0f172a]'}`}>
                          {label}{severity === value ? <LuCheck className="h-4 w-4" /> : null}
                        </button>
                      ))}
                    </>
                  ) : null}
                  <div className={MENU_LABEL}>Sort</div>
                  {([['position', 'Document order'], ['newest', 'Newest']] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)} className={`${MENU_ITEM} ${sort === value ? 'font-semibold text-[#1d4ed8]' : 'text-[#0f172a]'}`}>
                      {label}{sort === value ? <LuCheck className="h-4 w-4" /> : null}
                    </button>
                  ))}
                  {canComment ? (
                    <>
                      <div className="my-1 h-px bg-[#f1f5f9]" />
                      <div className={MENU_LABEL}>Review for</div>
                      {REVIEW_FOCUS_OPTIONS.map((option) => (
                        <button key={option.label} type="button" disabled={review.running} onClick={() => { setReviewMenu(false); props.onRunReview(option.focus); }} className={`${MENU_ITEM} text-[#0f172a]`}>
                          {option.label}
                        </button>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            {canComment ? (
              <button
                type="button"
                disabled={review.running}
                onClick={() => { setReviewMenu(false); props.onRunReview(); }}
                className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-[var(--theme-primary,#2563eb)] transition-colors hover:bg-[#eff6ff] disabled:opacity-70"
              >
                <LuSparkles className={`h-[15px] w-[15px] ${review.running ? 'animate-pulse' : ''}`} />
                {review.running ? 'Reviewing…' : 'Review'}
              </button>
            ) : null}
          </div>
        </div>
        {searchOpen ? (
          <label className="relative mt-2 block">
            <LuSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search comments"
              className="h-8 w-full rounded-lg border border-[#e2e8f0] bg-white pl-8 pr-2 text-[13px] text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)]"
            />
          </label>
        ) : null}
        {props.filter ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#eff6ff] px-2.5 py-1.5 text-[12.5px] text-[#1d4ed8]">
            <span className="min-w-0 flex-1 truncate font-medium">
              {CHECK_TITLES[props.filter.check] || 'Review'}
              {props.filter.category ? ` · ${CATEGORY_LABELS[props.filter.category] || props.filter.category}` : ''}
            </span>
            <button type="button" aria-label="Show all comments" onClick={props.onClearFilter} className="text-[#60a5fa] hover:text-[#1d4ed8]"><LuX className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
        {notice ? (
          <div className={`mt-1.5 flex items-center gap-1.5 px-2 text-[12.5px] ${notice.tone}`}>
            {review.error ? null : <LuCheck className="h-3.5 w-3.5" />}
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button type="button" aria-label="Dismiss" onClick={props.onDismissReviewNotice} className="text-[#94a3b8] hover:text-[#334155]"><LuX className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
        {review.outOfCredits ? <div className="mt-2"><CreditsUpsell feature="AI review" isMobile={props.isMobile} onDismiss={props.onDismissReviewNotice} /></div> : null}
      </div>

      {canComment && (initialSelectedText || initialBlockId) ? (
        <div className="px-3 pb-1 pt-1.5">
          <div className="rounded-[12px] border border-[var(--theme-primary,#2563eb)] p-2.5 shadow-[0_0_0_3px_#eff6ff]">
            {initialSelectedText ? (
              <div className="mb-2 line-clamp-2 border-l-2 border-[#fbbf24] pl-2.5 text-[13px] text-[#64748b]">{initialSelectedText}</div>
            ) : null}
            <textarea
              autoFocus
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && newText.trim()) {
                  event.preventDefault();
                  props.onAddComment({ text: newText.trim(), selectedText: initialSelectedText, blockId: initialBlockId });
                  setNewText('');
                }
              }}
              placeholder="Add a comment…"
              aria-label="New comment"
              className="min-h-[52px] w-full resize-none bg-transparent px-0.5 text-[13.5px] text-[#0f172a] outline-none placeholder:text-[#94a3b8]"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!newText.trim()}
                onClick={() => {
                  props.onAddComment({ text: newText.trim(), selectedText: initialSelectedText, blockId: initialBlockId });
                  setNewText('');
                }}
                className={ACTION_PRIMARY}
              >
                Comment
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1.5">
        {visible.length === 0 && comments.length ? (
          <p className="px-2 py-8 text-center text-[13px] text-[#94a3b8]">No matching comments</p>
        ) : null}
        {comments.length === 0 ? (
          <div className="flex flex-col items-center px-6 pt-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f1f5f9] text-[#94a3b8]"><LuMessageSquare className="h-5 w-5" /></span>
            <p className="mt-3 text-[14px] font-semibold text-[#0f172a]">No comments yet</p>
            <p className="mt-1 text-[13px] text-[#64748b]">Select text to comment, or let AI review it.</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          {visible.map((comment) => {
            const active = comment.id === activeCommentId;
            const ai = isAI(comment);
            const resolved = isResolved(comment);
            const canManage = ai || comment.actorSessionId === currentUserSessionId || currentUserSessionId === null;
            const showReply = canComment && !resolved && active;
            return (
              <article
                key={comment.id}
                data-comment-id={comment.id}
                className={`group rounded-[12px] border px-3 pb-2 pt-2.5 text-[13.5px] leading-[1.5] text-[#334155] transition-[border-color,box-shadow] ${
                  active ? 'border-[#fbbf24] shadow-[0_0_0_3px_#fef3c7]' : 'border-[#eef2f6] hover:border-[#e2e8f0]'
                } ${resolved ? 'opacity-60' : ''}`}
              >
                <button type="button" onClick={() => onActiveCommentChange?.(comment.id)} className="block w-full text-left">
                  <div className="mb-1.5 flex items-center gap-2 text-[13px] text-[#0f172a]">
                    <Avatar ai={ai} name={comment.actorDisplayName} />
                    <b className="truncate font-semibold">{ai ? 'Videmak AI' : comment.actorDisplayName}</b>
                    {ai ? (
                      <span title={comment.severity === 'major' ? 'Major' : 'Minor'} className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold ${comment.severity === 'major' ? 'bg-[#fef2f2] text-[#b91c1c]' : 'bg-[#f1f5f9] text-[#475569]'}`}>
                        {comment.check && comment.category && CATEGORY_LABELS[comment.category] ? CATEGORY_LABELS[comment.category] : comment.severity === 'major' ? 'Major' : 'Minor'}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[12px] text-[#94a3b8]" title={timeLabel(comment.createdAt)}>{relativeTime(comment.createdAt)}</span>
                  </div>
                  {comment.selectedText ? (
                    <div className="mb-1.5 line-clamp-2 border-l-2 border-[#fbbf24] pl-2.5 text-[13px] text-[#64748b]">{comment.selectedText}</div>
                  ) : null}
                </button>

                {editingId === comment.id ? (
                  <div>
                    <textarea autoFocus value={editingText} onChange={(event) => setEditingText(event.target.value)} aria-label="Edit comment" className="min-h-[56px] w-full resize-none rounded-lg border border-[#e2e8f0] px-2.5 py-2 text-[13.5px] text-[#0f172a] outline-none focus:border-[var(--theme-primary,#2563eb)]" />
                    <div className="mt-1.5 flex justify-end gap-1">
                      <button type="button" onClick={() => setEditingId(null)} className={ACTION}>Cancel</button>
                      <button
                        type="button"
                        disabled={!editingText.trim()}
                        onClick={() => {
                          props.onUpdateComment(comment.id, editingText);
                          setEditingId(null);
                        }}
                        className={ACTION_PRIMARY}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{comment.text}</p>
                )}

                {ai && comment.suggestion && !resolved ? (
                  <p className="mt-1.5 rounded-lg bg-[#f0fdf4] px-2.5 py-1.5 text-[13px] text-[#166534]">{comment.suggestion}</p>
                ) : null}

                {(comment.replies || []).length ? (
                  <div className="mt-2 flex flex-col gap-2 border-l-2 border-[#f1f5f9] pl-2.5">
                    {(comment.replies || []).map((reply) => (
                      <div key={reply.id}>
                        <div className="flex items-center gap-1.5 text-[12.5px]">
                          <span className="font-semibold text-[#0f172a]">{reply.ai ? 'Videmak AI' : reply.actorDisplayName}</span>
                          <span className="text-[12px] text-[#94a3b8]" title={timeLabel(reply.createdAt)}>{relativeTime(reply.createdAt)}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-[13px] text-[#334155]">{reply.text}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {asking === comment.id ? <div className="mt-1.5 text-[12.5px] text-[#64748b]">Videmak AI is replying…</div> : null}

                <div className="-mb-0.5 mt-1 flex items-center gap-0.5">
                  {ai && comment.suggestion && !resolved && canComment ? (
                    <button type="button" onClick={() => props.onAcceptSuggestion(comment)} className={`${ACTION_PRIMARY} mr-1`}>Accept</button>
                  ) : null}
                  {ai && !resolved && props.onFindSource ? (
                    <button type="button" onClick={() => props.onFindSource?.(comment)} className={ACTION}><LuQuote className="h-3.5 w-3.5" />Find source</button>
                  ) : null}
                  <div className="ml-auto flex items-center">
                    {canComment ? (
                      <button type="button" onClick={() => props.onResolveComment(comment.id, !resolved)} aria-label={resolved ? 'Reopen' : 'Resolve'} title={resolved ? 'Reopen' : 'Resolve'} className={`${ICON_BUTTON} h-7 w-7 ${resolved ? 'text-[#15803d]' : ''}`}>
                        <LuCheck className="h-4 w-4" />
                      </button>
                    ) : null}
                    {ai ? (
                      <>
                        <button type="button" aria-label="Helpful" aria-pressed={comment.feedback === 'up'} onClick={() => props.onFeedback(comment.id, comment.feedback === 'up' ? null : 'up')} className={`${ICON_BUTTON} h-7 w-7 ${comment.feedback === 'up' ? 'text-[var(--theme-primary,#2563eb)]' : ''}`}>
                          <LuThumbsUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" aria-label="Not helpful" aria-pressed={comment.feedback === 'down'} onClick={() => props.onFeedback(comment.id, comment.feedback === 'down' ? null : 'down')} className={`${ICON_BUTTON} h-7 w-7 ${comment.feedback === 'down' ? 'text-[var(--theme-primary,#2563eb)]' : ''}`}>
                          <LuThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                    <div className="relative">
                      <button type="button" aria-label="More options" aria-expanded={menuId === comment.id} onClick={() => setMenuId(menuId === comment.id ? null : comment.id)} className={`${ICON_BUTTON} h-7 w-7`}>
                        <LuEllipsis className="h-4 w-4" />
                      </button>
                      {menuId === comment.id ? (
                        <div className="absolute right-0 top-8 z-20 min-w-[150px] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                          {canManage && !ai ? (
                            <button type="button" onClick={() => { setEditingId(comment.id); setEditingText(comment.text); setMenuId(null); }} className={`${MENU_ITEM} text-[#0f172a]`}>Edit</button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              const url = new URL(window.location.href);
                              url.searchParams.set('comment', comment.id);
                              void navigator.clipboard?.writeText(url.toString()).catch(() => undefined);
                              setMenuId(null);
                            }}
                            className={`${MENU_ITEM} text-[#0f172a]`}
                          >
                            Copy link
                          </button>
                          {canManage ? (
                            <button type="button" onClick={() => { props.onDeleteComment(comment.id); setMenuId(null); }} className={`${MENU_ITEM} text-[#b91c1c] hover:bg-[#fef2f2]`}>{ai ? 'Dismiss' : 'Delete'}</button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {showReply ? (
                  <div className="relative mt-1.5">
                    <input
                      value={replyDrafts[comment.id] ?? ''}
                      onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void submitReply(comment);
                        }
                      }}
                      placeholder={ai ? 'Reply to Videmak AI…' : 'Reply…'}
                      aria-label="Reply"
                      className="h-9 w-full rounded-lg border border-[#e2e8f0] bg-white pl-2.5 pr-9 text-[13px] text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)]"
                    />
                    <button
                      type="button"
                      aria-label="Send reply"
                      disabled={!replyDrafts[comment.id]?.trim() || asking === comment.id}
                      onClick={() => void submitReply(comment)}
                      className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-[var(--theme-primary,#2563eb)] text-white disabled:bg-transparent disabled:text-[#cbd5e1]"
                    >
                      <LuArrowUp className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
