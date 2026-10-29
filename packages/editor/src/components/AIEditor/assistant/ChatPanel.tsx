'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LuArrowUp, LuAtSign, LuCopy, LuFileText, LuGlobe, LuHistory, LuLibrary, LuListPlus, LuPaperclip, LuSparkles, LuSquarePen, LuTrash2, LuX } from 'react-icons/lu';
import { toast } from 'react-hot-toast';
import CreditsUpsell from './CreditsUpsell';
import {
  AssistError,
  deleteChat,
  getChat,
  listChats,
  streamChat,
  type AssistSource,
  type ChatMessage,
  type ChatSummary,
} from '../../../lib/aiEditor/assistApi';
import { previewAIText, shortCitation } from '../../../lib/aiEditor/aiText';
import { getDocuments, uploadDocument, type LibraryDocumentResponse } from '../../../utils/libraryApi';
import { copyReference, notifyLibraryChanged } from '../../../lib/aiEditor/references';

export type ChatMention = { id: string; title: string };
export type ChatContext = { text: string; blockId?: string | null; label?: string };

type Props = {
  /** Null outside a document: the AI Chat works from the web and the Library only. */
  documentId: string | null;
  documentTitle?: string;
  getDocumentText?: () => string;
  context?: ChatContext | null;
  onClearContext?: () => void;
  mentions: ChatMention[];
  onMentionsChange: (mentions: ChatMention[]) => void;
  onInsert?: (message: ChatMessage) => void;
  /** In a document a source is cited into it; elsewhere its reference is copied. */
  onCiteSource?: (source: AssistSource) => void;
  canInsert?: boolean;
  isMobile?: boolean;
  /** Desktop: the panel draws its own title bar with history, new chat and close. */
  onClose?: () => void;
};

const SOURCES_KEY = 'ce-editor-chat-sources';
const STARTERS = ['Summarise this document', 'Find the weakest arguments', 'Which claims need citations?'];
const GENERAL_STARTERS = ['How do I write a strong research question?', 'What does recent research say about sleep and memory?', 'How should I structure a literature review?'];

function readSources() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SOURCES_KEY) || '{}');
    return { useDocument: value.useDocument !== false, useWeb: value.useWeb !== false, useLibrary: Boolean(value.useLibrary) };
  } catch {
    return { useDocument: true, useWeb: true, useLibrary: false };
  }
}

function Toggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${active ? 'Using' : 'Not using'} ${label.toLowerCase()}`}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium transition-colors ${
        active ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#334155]'
      }`}
    >
      {/* A narrow chat (the panel shares the screen with the menu and the page) shows the words only. */}
      <span className="hidden @[310px]/tools:inline-flex">{icon}</span>
      {label}
    </button>
  );
}


/** "Stickgold R · Nature · 2005" for a source row. */
function sourceMeta(source: AssistSource) {
  const names = (source.authors || []).filter(Boolean).map((name) => {
    const trimmed = name.trim();
    if (trimmed.includes(',')) {
      const [last, first] = trimmed.split(',');
      return `${last.trim()}${first?.trim() ? ` ${first.trim()[0]}` : ''}`;
    }
    const parts = trimmed.split(/\s+/);
    const last = parts.pop() || trimmed;
    return parts.length ? `${last} ${parts[0][0]}` : last;
  });
  const authors = names.length > 2 ? `${names[0]} et al.` : names.join(', ');
  return [authors, source.venue, source.year].filter(Boolean).join(' · ');
}

/** AI Chat beside the document: the document, the web (Scholar) and the Library as sources. */
export default function ChatPanel({
  documentId,
  documentTitle,
  getDocumentText,
  context,
  onClearContext,
  mentions,
  onMentionsChange,
  onInsert,
  onCiteSource,
  canInsert = false,
  isMobile,
  onClose,
}: Props) {
  const inDocument = Boolean(documentId);
  const [threads, setThreads] = useState<ChatSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sources, setSources] = useState({ useDocument: true, useWeb: true, useLibrary: false });
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<{ text: string; sources: AssistSource[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<LibraryDocumentResponse[] | null>(null);
  const [attaching, setAttaching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSources(readSources()), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
    } catch {
      /* a convenience only */
    }
  }, [sources]);

  const refreshThreads = useCallback(() => {
    listChats(documentId || '').then((response) => setThreads(response.chats)).catch(() => undefined);
  }, [documentId]);

  useEffect(() => {
    setThreadId(null);
    setMessages([]);
    refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    if (mentions.length) setSources((current) => (current.useLibrary ? current : { ...current, useLibrary: true }));
  }, [mentions.length]);

  useEffect(() => {
    // Follow the conversation; the empty state (suggestions) stays at the top.
    if (!messages.length && !pending) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  useEffect(() => {
    if (mentionQuery === null) return;
    const timer = window.setTimeout(() => {
      getDocuments({ search: mentionQuery || undefined, page_size: 6, order_by: 'created_at', order_desc: true })
        .then((response) => setMentionResults(response.documents))
        .catch(() => setMentionResults([]));
    }, mentionQuery ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [mentionQuery]);
  useEffect(() => {
    if (mentionQuery === null) setMentionResults(null);
  }, [mentionQuery]);

  const openThread = async (id: string) => {
    setShowHistory(false);
    try {
      const thread = await getChat(id);
      setThreadId(thread.id);
      setMessages(thread.messages || []);
    } catch (caught) {
      toast.error((caught as Error).message);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setPending(null);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    setMentionQuery(null);
    setOutOfCredits(false);
    const userMessage: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: message, selection: context?.text };
    setMessages((current) => [...current, userMessage]);
    setPending({ text: '', sources: [] });
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let answer = '';
    let answerSources: AssistSource[] = [];
    try {
      await streamChat(
        {
          documentId: documentId || '',
          threadId,
          message,
          documentTitle,
          documentText: inDocument && sources.useDocument ? getDocumentText?.() : undefined,
          selection: context?.text,
          useDocument: inDocument && sources.useDocument,
          sources: { useWeb: sources.useWeb, useLibrary: sources.useLibrary, libraryDocumentIds: mentions.map((mention) => mention.id) },
        },
        {
          onSources: (id, found) => {
            setThreadId(id);
            answerSources = found;
            setPending({ text: answer, sources: found });
          },
          onDelta: (delta) => {
            answer += delta;
            setPending({ text: answer, sources: answerSources });
          },
          onDone: (id, final) => {
            setThreadId(id);
            setMessages((current) => [...current, final]);
            setPending(null);
            refreshThreads();
          },
        },
        controller.signal,
      );
      window.dispatchEvent(new CustomEvent('credits-updated'));
    } catch (caught) {
      setPending(null);
      if ((caught as Error).name === 'AbortError') {
        if (answer) setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'assistant', content: answer, sources: answerSources }]);
      } else if (caught instanceof AssistError && caught.outOfCredits) {
        setOutOfCredits(true);
      } else {
        if (answer) setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'assistant', content: answer, sources: answerSources }]);
        toast.error((caught as Error).message || 'The chat stopped.');
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleInput = (value: string) => {
    setInput(value);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
    setMentionQuery(match ? match[1] : null);
  };

  const addMention = (document: { id: string; title?: string | null; filename?: string }) => {
    if (!mentions.some((mention) => mention.id === document.id)) {
      onMentionsChange([...mentions, { id: document.id, title: document.title || document.filename || 'Untitled' }]);
    }
    setInput((current) => current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => (match.startsWith(' ') ? ' ' : '')));
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const attach = async (file: File) => {
    setAttaching(true);
    try {
      const uploaded = await uploadDocument(file);
      notifyLibraryChanged();
      const id = (uploaded as any)?.id || (uploaded as any)?.document?.id || (uploaded as any)?.document_id;
      if (id) addMention({ id, title: file.name });
      toast.success(`${file.name} is in your Library; the AI can read it once processing finishes.`);
    } catch (caught) {
      toast.error((caught as Error).message || 'The file could not be attached.');
    } finally {
      setAttaching(false);
    }
  };

  const rendered = useMemo(
    () => (pending ? [...messages, { id: 'pending', role: 'assistant' as const, content: pending.text, sources: pending.sources }] : messages),
    [messages, pending],
  );

  const citeOrCopy = (source: AssistSource) => {
    if (onCiteSource) {
      onCiteSource(source);
      return;
    }
    copyReference(source.bibtex)
      .then(() => toast.success('Reference copied'))
      .catch(() => toast.error('The reference could not be copied.'));
  };

  // "Add context": an "@" in the message opens the Library picker, as typing one does.
  const addContext = () => {
    setInput((current) => (/(?:^|\s)@[^\s@]*$/.test(current) ? current : `${current}${current && !/\s$/.test(current) ? ' ' : ''}@`));
    setMentionQuery((current) => current ?? '');
    inputRef.current?.focus();
  };

  const starters = inDocument ? STARTERS : GENERAL_STARTERS;
  const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]';
  const historyMenu = (
    <div className="relative">
      <button type="button" onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory} aria-label="Chat history" title="Chat history" className={iconButton}>
        <LuHistory className="h-[17px] w-[17px]" />
      </button>
      {showHistory ? (
        <div className="absolute right-0 top-9 z-20 max-h-[320px] w-[280px] overflow-y-auto rounded-[14px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
          {threads.length === 0 ? <div className="px-3 py-2.5 text-[13px] text-[#64748b]">No chats yet</div> : null}
          {threads.map((thread) => (
            <div key={thread.id} className={`group flex items-center gap-1 rounded-[10px] px-1 ${thread.id === threadId ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`}>
              <button type="button" onClick={() => void openThread(thread.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
                <div className="truncate text-[13.5px] font-medium text-[#0f172a]">{thread.title}</div>
                <div className="text-[12px] text-[#64748b]">{new Date(thread.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </button>
              <button
                type="button"
                aria-label="Delete chat"
                onClick={async () => {
                  await deleteChat(thread.id).catch(() => undefined);
                  if (thread.id === threadId) newChat();
                  refreshThreads();
                }}
                className="rounded-lg p-1.5 text-[#94a3b8] opacity-70 hover:bg-white hover:text-[#334155] group-hover:opacity-100"
              >
                <LuTrash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
  const newChatButton = (
    <button type="button" onClick={newChat} aria-label="New chat" title="New chat" className={iconButton}>
      <LuSquarePen className="h-[17px] w-[17px]" />
    </button>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      {onClose ? (
        <div className="flex h-[52px] shrink-0 items-center gap-0.5 border-b border-[#f1f5f9] pl-4 pr-2">
          <h2 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[#0f172a]">AI Chat</h2>
          {historyMenu}
          {newChatButton}
          <button type="button" onClick={onClose} aria-label="Close panel" title="Close" className={iconButton}>
            <LuX className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-0.5 px-2.5 pt-2">
          {historyMenu}
          {newChatButton}
        </div>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pb-2 pt-3">
        {rendered.length === 0 ? (
          <div className="my-auto flex flex-col items-center px-1 pb-4 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#eff6ff] text-[var(--theme-primary,#2563eb)]">
              <LuSparkles className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[16px] font-semibold text-[#0f172a]">How can I help?</p>
            <div className="mt-4 flex w-full flex-col gap-1.5">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void send(starter)}
                  className="rounded-[12px] border border-[#e5e7eb] px-3 py-2.5 text-left text-[13.5px] leading-snug text-[#334155] transition-colors hover:border-[#bfdbfe] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {rendered.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="max-w-[82%] self-end rounded-[16px_16px_4px_16px] bg-[var(--theme-primary,#2563eb)] px-[14px] py-[10px] text-[14px] leading-[1.5] text-white">
              {message.selection ? <div className="mb-1.5 line-clamp-2 border-l-2 border-white/40 pl-2 text-[12.5px] text-white/80">{message.selection}</div> : null}
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ) : (
            <div key={message.id} className="text-[14px] leading-[1.6] text-[#334155] [&_b]:font-bold [&_b]:text-[#0f172a] [&_strong]:font-bold [&_strong]:text-[#0f172a]">
              {message.content ? (
                <div className="ce-chat-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewAIText(message.content, new Map(), message.sources || [])}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-1 text-[13px] text-[#64748b]">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8] [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8] [animation-delay:240ms]" />
                  {message.sources?.length ? `Reading ${message.sources.length} sources…` : 'Thinking…'}
                </div>
              )}
              {message.sources?.length && message.id !== 'pending' ? (
                <div className="mt-[10px] flex flex-col gap-[7px]">
                  {message.sources.map((source) => (
                    <div key={`${message.id}-${source.n}`} className="flex items-start gap-[9px] rounded-[11px] border border-[#e5e7eb] px-[10px] py-[9px] text-[12.5px] leading-[1.4]">
                      <em className="shrink-0 rounded-[6px] bg-[#eff6ff] px-[6px] py-[1px] text-[12px] font-bold not-italic text-[var(--theme-primary,#2563eb)]">{source.n}</em>
                      <span className="min-w-0 flex-1">
                        <b className="block font-bold text-[#0f172a]" title={source.title}>{source.title || shortCitation(source)}</b>
                        <span className="text-[#64748b]">{sourceMeta(source) || shortCitation(source)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => citeOrCopy(source)}
                        disabled={!source.bibtex || (Boolean(onCiteSource) && !canInsert)}
                        aria-label={`${onCiteSource ? 'Cite' : 'Copy reference for'} ${shortCitation(source)}`}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold text-[var(--theme-primary,#2563eb)] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                      >
                        {onCiteSource ? '+ Cite' : <><LuCopy className="h-3.5 w-3.5" />Copy</>}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {message.id !== 'pending' && message.content && onInsert && canInsert ? (
                <div className="mt-2 flex">
                  <button
                    type="button"
                    onClick={() => onInsert(message)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#eff6ff] hover:text-[#1d4ed8]"
                  >
                    <LuListPlus className="h-4 w-4" /> Insert
                  </button>
                </div>
              ) : null}
            </div>
          ),
        )}
        {outOfCredits ? <CreditsUpsell feature="AI Chat" isMobile={isMobile} onDismiss={() => setOutOfCredits(false)} /> : null}
      </div>

      <div className={isMobile ? 'border-t border-[#f1f5f9] bg-white px-3 pb-3 pt-2.5' : 'bg-white px-3 pb-3 pt-1'}>
        <div className="relative rounded-[16px] border border-[#e2e8f0] bg-white px-3 pb-2 pt-2 transition-shadow focus-within:border-[var(--theme-primary,#2563eb)] focus-within:shadow-[0_0_0_3px_#eff6ff]">
          {mentionQuery !== null && mentionResults ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
              <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-medium text-[#94a3b8]">Library</div>
              {mentionResults.length === 0 ? <div className="px-3 pb-2 pt-0.5 text-[13px] text-[#64748b]">{mentionQuery ? 'No matches' : 'Your Library is empty'}</div> : null}
              {mentionResults.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addMention(document);
                  }}
                  className="flex w-full items-center gap-2 rounded-[9px] px-3 py-2 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  <LuFileText className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                  <span className="truncate">{document.title || document.filename}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={addContext}
              className="inline-flex h-6 items-center gap-1 rounded-[7px] border border-[#e5e7eb] px-1.5 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a]"
            >
              <LuAtSign className="h-3 w-3" />Add context
            </button>
            {context ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-[7px] border border-[#e5e7eb] bg-[#f8fafc] px-1.5 py-0.5 text-[12px] text-[#334155]">
                <span className="truncate">“{context.label || context.text.slice(0, 60)}”</span>
                <button type="button" aria-label="Remove context" onClick={onClearContext} className="text-[#94a3b8] hover:text-[#334155]">
                  <LuX className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
            {mentions.map((mention) => (
              <span key={mention.id} className="inline-flex max-w-[220px] items-center gap-1 rounded-[7px] border border-[#dbeafe] bg-[#eff6ff] px-1.5 py-0.5 text-[12px] font-medium text-[#1d4ed8]">
                <span className="truncate">@{mention.title}</span>
                <button type="button" aria-label={`Remove ${mention.title}`} onClick={() => onMentionsChange(mentions.filter((item) => item.id !== mention.id))}>
                  <LuX className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => handleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && mentionQuery !== null) {
                event.preventDefault();
                setMentionQuery(null);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={inDocument ? 'Ask about your document…' : 'Ask anything…'}
            aria-label="Message Videmak AI"
            className={`block max-h-40 min-h-[24px] w-full resize-none bg-transparent px-0.5 leading-[1.45] text-[#0f172a] outline-none placeholder:text-[#94a3b8] ${isMobile ? 'text-[16px]' : 'text-[14.5px]'}`}
          />
          <div className="@container/tools mt-1.5 flex items-center gap-0.5 text-[#64748b]">
            <button
              type="button"
              aria-label="Attach a PDF"
              title="Attach a PDF"
              disabled={attaching}
              onClick={() => fileRef.current?.click()}
              className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a] disabled:opacity-50"
            >
              <LuPaperclip className="h-4 w-4" />
            </button>
            <Toggle active={sources.useWeb} onClick={() => setSources((s) => ({ ...s, useWeb: !s.useWeb }))} icon={<LuGlobe className="h-3.5 w-3.5" />} label="Web" />
            <Toggle active={sources.useLibrary} onClick={() => setSources((s) => ({ ...s, useLibrary: !s.useLibrary }))} icon={<LuLibrary className="h-3.5 w-3.5" />} label="Library" />
            {inDocument ? (
              <Toggle active={sources.useDocument} onClick={() => setSources((s) => ({ ...s, useDocument: !s.useDocument }))} icon={<LuFileText className="h-3.5 w-3.5" />} label="Document" />
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void attach(file);
              }}
            />
            {streaming ? (
              <button type="button" aria-label="Stop" onClick={() => abortRef.current?.abort()} className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-white">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                disabled={!input.trim()}
                onClick={() => void send(input)}
                className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary,#2563eb)] text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-default disabled:bg-[#e2e8f0] disabled:text-[#94a3b8]"
              >
                <LuArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
