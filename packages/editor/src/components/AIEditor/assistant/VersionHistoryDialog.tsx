'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LuHistory, LuPencil, LuRotateCcw, LuX } from 'react-icons/lu';
import { toast } from 'react-hot-toast';
import {
  getVersion,
  listVersions,
  renameVersion,
  restoreVersion,
  saveNamedVersion,
  type DocumentVersion,
  type DocumentVersionContent,
} from '../../../lib/aiEditor/assistApi';
import { visibleText } from '../../../lib/aiEditor/aiText';
import { editorConfirm, editorPrompt } from '../../../lib/aiEditor/editorDialogs';

type Line = { kind: string; level?: number; text: string };

/** Readable lines of a block tree (headings, paragraphs, list items, table rows). */
export function blocksToLines(blocks: any[], depth = 0): Line[] {
  const lines: Line[] = [];
  (blocks || []).forEach((block) => {
    if (!block) return;
    if (block.type === 'table') {
      (block.content?.rows || []).forEach((row: any) => {
        lines.push({ kind: 'table', text: (row.cells || []).map((cell: any) => visibleText(Array.isArray(cell) ? cell : cell?.content)).join('  |  ') });
      });
    } else if (block.type === 'image') {
      lines.push({ kind: 'media', text: `[Image${block.props?.caption ? `: ${block.props.caption}` : ''}]` });
    } else if (block.type === 'equation') {
      lines.push({ kind: 'media', text: `[Equation: ${block.props?.latex || ''}]` });
    } else if (block.type === 'pageBreak') {
      lines.push({ kind: 'media', text: '— page break —' });
    } else if (Array.isArray(block.content)) {
      const text = visibleText(block.content);
      lines.push({
        kind: block.type,
        level: block.type === 'heading' ? Number(block.props?.level) || 1 : depth,
        text: block.type === 'bulletListItem' ? `• ${text}` : block.type === 'numberedListItem' ? `– ${text}` : text,
      });
    }
    if (Array.isArray(block.children) && block.children.length) lines.push(...blocksToLines(block.children, depth + 1));
  });
  return lines.filter((line) => line.text.trim() || line.kind === 'paragraph');
}

type Piece = { text: string; change: 'same' | 'added' | 'removed' };

function lcsDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { op: 'same' | 'add' | 'del'; a?: T; b?: T }[] {
  const n = a.length;
  const m = b.length;
  // Bounded: very long documents fall back to a positional comparison.
  if (n * m > 4_000_000) {
    const out: { op: 'same' | 'add' | 'del'; a?: T; b?: T }[] = [];
    for (let i = 0; i < Math.max(n, m); i += 1) {
      if (i < n && i < m && eq(a[i], b[i])) out.push({ op: 'same', a: a[i], b: b[i] });
      else {
        if (i < n) out.push({ op: 'del', a: a[i] });
        if (i < m) out.push({ op: 'add', b: b[i] });
      }
    }
    return out;
  }
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = eq(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: { op: 'same' | 'add' | 'del'; a?: T; b?: T }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push({ op: 'same', a: a[i], b: b[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ op: 'del', a: a[i] });
      i += 1;
    } else {
      out.push({ op: 'add', b: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ op: 'del', a: a[i++] });
  while (j < m) out.push({ op: 'add', b: b[j++] });
  return out;
}

function wordDiff(before: string, after: string): Piece[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  return lcsDiff(a, b, (x, y) => x === y).map((step) =>
    step.op === 'same' ? { text: step.b as string, change: 'same' } : step.op === 'add' ? { text: step.b as string, change: 'added' } : { text: step.a as string, change: 'removed' },
  );
}

type DiffLine = { kind: string; level?: number; pieces: Piece[]; change: 'same' | 'added' | 'removed' | 'changed' };

/** What changed from `older` to `newer`, line by line, with word-level changes inside a line. */
export function diffLines(older: Line[], newer: Line[]): DiffLine[] {
  const steps = lcsDiff(older, newer, (x, y) => x.text === y.text);
  const out: DiffLine[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (step.op === 'same') out.push({ kind: step.b!.kind, level: step.b!.level, pieces: [{ text: step.b!.text, change: 'same' }], change: 'same' });
    else if (step.op === 'del' && next?.op === 'add' && step.a!.kind === next.b!.kind) {
      out.push({ kind: next.b!.kind, level: next.b!.level, pieces: wordDiff(step.a!.text, next.b!.text), change: 'changed' });
      index += 1;
    } else if (step.op === 'del') out.push({ kind: step.a!.kind, level: step.a!.level, pieces: [{ text: step.a!.text, change: 'removed' }], change: 'removed' });
    else out.push({ kind: step.b!.kind, level: step.b!.level, pieces: [{ text: step.b!.text, change: 'added' }], change: 'added' });
  }
  return out;
}

function LineView({ line }: { line: DiffLine }) {
  const content = line.pieces.map((piece, index) =>
    piece.change === 'same' ? (
      <React.Fragment key={index}>{piece.text}</React.Fragment>
    ) : piece.change === 'added' ? (
      <ins key={index} className="bg-[#dcfce7] text-[#166534] no-underline">{piece.text}</ins>
    ) : (
      <del key={index} className="bg-[#fef2f2] text-[#991b1b]">{piece.text}</del>
    ),
  );
  const tone = line.change === 'added' ? 'border-l-[3px] border-[#34a853] pl-2' : line.change === 'removed' ? 'border-l-[3px] border-[#ea4335] pl-2' : line.change === 'changed' ? 'border-l-[3px] border-[#f59e0b] pl-2' : '';
  if (line.kind === 'heading') {
    const size = line.level === 1 ? 'text-[22px]' : line.level === 2 ? 'text-[18px]' : 'text-[16px]';
    return <h3 className={`mb-2 mt-4 font-semibold text-[#0f172a] ${size} ${tone}`}>{content}</h3>;
  }
  return <p className={`mb-2 whitespace-pre-wrap text-[14px] leading-relaxed text-[#0f172a] ${line.kind === 'table' ? 'font-mono text-[12px]' : ''} ${tone}`} style={line.level ? { marginLeft: line.level * 16 } : undefined}>{content}</p>;
}

function versionLabel(version: DocumentVersion) {
  if (version.label) return version.label;
  if (version.reason === 'import') return 'Imported';
  if (version.reason === 'before-restore') return 'Before a restore';
  if (version.reason === 'manual') return 'Saved version';
  if (version.reason === 'ai') return 'AI suggestions accepted';
  return '';
}

export default function VersionHistoryDialog({
  isOpen,
  onClose,
  documentId,
  getCurrentBlocks,
  canRestore,
  onRestore,
  prepare,
}: {
  isOpen: boolean;
  onClose: () => void;
  documentId: string | null;
  getCurrentBlocks: () => any[];
  canRestore: boolean;
  onRestore: (version: DocumentVersionContent) => void;
  /** Saves the live document to the server first (realtime documents keep only a periodic copy there). */
  prepare?: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<DocumentVersionContent | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await listVersions(documentId);
      setVersions(response.versions);
      setSelectedId((current) => current ?? response.versions[0]?.id ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen) {
      // Save the live document first; a first version is recorded in the background.
      void (async () => {
        await prepare?.();
        await load();
        window.setTimeout(() => void load(), 2000);
      })();
    } else {
      setSelectedId(null);
      setContent(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen || !documentId || !selectedId) return;
    let cancelled = false;
    setContent(null);
    getVersion(documentId, selectedId)
      .then((version) => !cancelled && setContent(version))
      .catch((caught) => !cancelled && setError((caught as Error).message));
    return () => {
      cancelled = true;
    };
  }, [documentId, isOpen, selectedId]);

  const lines = useMemo(() => {
    if (!content) return [];
    const versionLines = blocksToLines(content.blocks);
    if (!showChanges) return versionLines.map((line) => ({ kind: line.kind, level: line.level, pieces: [{ text: line.text, change: 'same' as const }], change: 'same' as const }));
    // Changes from this version to the document as it is now.
    return diffLines(versionLines, blocksToLines(getCurrentBlocks()));
  }, [content, getCurrentBlocks, showChanges]);

  const groups = useMemo(() => {
    const byDay = new Map<string, DocumentVersion[]>();
    versions.forEach((version) => {
      const day = new Date(version.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      byDay.set(day, [...(byDay.get(day) || []), version]);
    });
    return Array.from(byDay.entries());
  }, [versions]);

  // Escape closes the dialog, like the other editor dialogs.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[13050] flex items-stretch justify-center bg-[rgba(15,23,42,0.35)] md:p-6" role="dialog" aria-modal="true" aria-label="Version history">
      <div className="flex min-h-0 w-full max-w-[1200px] flex-col overflow-hidden bg-white md:rounded-[16px] md:border md:border-[#e5e7eb] md:shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#e5e7eb] px-4 py-3">
          <div className="flex items-center gap-2 text-[18px] font-bold text-[#0f172a]">
            <LuHistory className="h-5 w-5 text-[#64748b]" /> Version history
          </div>
          <div className="flex items-center gap-2">
            <label className="hidden items-center gap-1.5 text-[13px] text-[#334155] sm:inline-flex">
              <input type="checkbox" className="accent-[var(--theme-primary,#2563eb)]" checked={showChanges} onChange={(event) => setShowChanges(event.target.checked)} /> Show changes since
            </label>
            {canRestore && documentId ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const label = await editorPrompt({ title: 'Name the current version', label: 'Version name', placeholder: 'e.g. Sent to supervisor', okLabel: 'Save version', allowEmpty: true });
                  if (label === null) return;
                  setBusy(true);
                  try {
                    await prepare?.();
                    await saveNamedVersion(documentId, label.trim() || undefined);
                    toast.success('Version saved');
                    await load();
                  } catch (caught) {
                    toast.error((caught as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-9 rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#0f172a] hover:bg-[#f8fafc]"
              >
                Name current version
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close version history" className="rounded-[9px] p-1.5 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]">
              <LuX className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8fafc] px-3 py-4 md:px-8">
            <div className="mx-auto max-w-[760px] rounded-[14px] border border-[#e5e7eb] bg-white px-5 py-6 md:px-10">
              {!content ? (
                <div className="space-y-2">{[0, 1, 2, 3].map((index) => <div key={index} className="h-4 animate-pulse rounded bg-[#f1f5f9]" />)}</div>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[18px] font-bold text-[#0f172a]">{content.title}</h2>
                    {canRestore ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!documentId || !(await editorConfirm({ title: 'Restore this version?', message: 'The current text is kept as a version too, so you can go back.', okLabel: 'Restore' }))) return;
                          setBusy(true);
                          try {
                            await prepare?.();
                            const restored = await restoreVersion(documentId, content.id);
                            onRestore(restored);
                            toast.success('Version restored');
                            onClose();
                          } catch (caught) {
                            toast.error((caught as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-4 text-[13px] font-semibold text-white hover:bg-[#1d4ed8]"
                      >
                        <LuRotateCcw className="h-4 w-4" /> Restore this version
                      </button>
                    ) : null}
                  </div>
                  {showChanges ? <p className="mb-3 text-[12px] text-[#64748b]">Highlighted: what changed from this version to the document now (<span className="text-[#166534]">added</span>, <span className="text-[#991b1b] line-through">removed</span>).</p> : null}
                  <div className="text-[16px] leading-[1.7] text-[#1e293b]" style={{ fontFamily: "var(--font-serif), 'Source Serif 4', Georgia, serif" }}>
                    {lines.map((line, index) => <LineView key={index} line={line} />)}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="max-h-[38vh] min-h-0 shrink-0 overflow-y-auto border-b border-[#e5e7eb] md:max-h-none md:w-[300px] md:border-b-0 md:border-l">
            {loading ? <div className="p-4 text-[13px] text-[#64748b]">Loading versions…</div> : null}
            {error ? <div className="m-3 rounded-xl bg-[#fef2f2] px-3 py-2 text-[13px] text-[#991b1b]">{error}</div> : null}
            {!loading && !error && versions.length === 0 ? (
              <div className="p-4 text-[13px] text-[#64748b]">No versions yet. Versions are saved automatically while you write (every 10 minutes of changes).</div>
            ) : null}
            {groups.map(([day, items]) => (
              <div key={day}>
                <div className="sticky top-0 bg-white px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{day}</div>
                {items.map((version) => {
                  const selected = version.id === selectedId;
                  const label = versionLabel(version);
                  return (
                    <div key={version.id} className={`group mx-2 rounded-[10px] px-3 py-2 ${selected ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`}>
                      {renaming === version.id ? (
                        <form
                          onSubmit={async (event) => {
                            event.preventDefault();
                            if (!documentId) return;
                            await renameVersion(documentId, version.id, renameValue.trim() || null).catch((caught) => toast.error((caught as Error).message));
                            setRenaming(null);
                            void load();
                          }}
                        >
                          <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => setRenaming(null)} className="h-8 w-full rounded-lg border border-[#e5e7eb] px-2 text-[13px] outline-none" />
                        </form>
                      ) : (
                        <button type="button" onClick={() => setSelectedId(version.id)} className="block w-full text-left">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13.5px] font-medium text-[#0f172a]">{new Date(version.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                            {canRestore ? (
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label="Name this version"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRenaming(version.id);
                                  setRenameValue(version.label || '');
                                }}
                                className="rounded-full p-1 text-[#64748b] opacity-0 hover:bg-white group-hover:opacity-100"
                              >
                                <LuPencil className="h-3.5 w-3.5" />
                              </span>
                            ) : null}
                          </div>
                          {label ? <div className="truncate text-[12.5px] font-medium text-[var(--theme-primary-dark)]">{label}</div> : null}
                          <div className="truncate text-[11.5px] text-[#64748b]">{version.authorName} · {version.wordCount.toLocaleString()} words</div>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
