'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AssistError, autocomplete, type AssistSource, type AutocompleteSettings } from './assistApi';
import { aiTextToInline, previewAIText } from './aiText';
import { clearGhost, currentGhost, paragraphShape, showGhost } from './autocomplete';
import { safeView } from './editorPlugins';
import moduleAnalytics from '../../utils/moduleAnalytics';

const IDLE_MS = 1300;
const MIN_GAP_MS = 3500;

type Options = {
  editor: any;
  enabled: boolean;
  documentTitle?: string;
  /** aiCitation items for the sources an accepted suggestion cites. */
  makeCitations: (sources: AssistSource[]) => any[];
  onOutOfCredits: () => void;
  /** Accepted AI text, so the host can record it in the version history. */
  onAccepted?: (accepted: { words: number; manual: boolean }) => void;
  /** Conclude suggested a title for an untitled document. */
  onTitle?: (title: string) => void;
  settings?: AutocompleteSettings;
};

type RequestOptions = { refine?: string; manual?: boolean; conclude?: boolean };
type GhostResult = { text: string; sources: AssistSource[]; before: string; manual: boolean; conclude: boolean; heading?: string | null; title?: string | null };

export type GhostBar = { id: number; top: number; left: number; loading: boolean; manual: boolean; heading?: string | null };

function textOf(node: any): string {
  let text = '';
  node.descendants?.((child: any) => {
    if (child.isText) text += child.text;
    else if (child.type?.name === 'aiCitation') text += child.attrs?.displayText || '';
    return true;
  });
  return text;
}

/**
 * Autocomplete: after a pause at the end of a paragraph, ask for the next
 * sentence (with citations) and show it as ghost text; Tab accepts.
 */
export function useAutocomplete({ editor, enabled, documentTitle, makeCitations, onOutOfCredits, onAccepted, onTitle, settings }: Options) {
  const [bar, setBar] = useState<GhostBar | null>(null);
  /** Where "Videmak AI" is writing (the caret flag) while an asked-for suggestion loads. */
  const [writingAt, setWritingAt] = useState<{ top: number; left: number } | null>(null);
  const resultRef = useRef<Map<number, GhostResult>>(new Map());
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef({ at: 0, key: '' });
  const counterRef = useRef(0);
  const pausedRef = useRef(false);
  const optionsRef = useRef({ documentTitle, makeCitations, onOutOfCredits, onAccepted, onTitle, settings, enabled });
  optionsRef.current = { documentTitle, makeCitations, onOutOfCredits, onAccepted, onTitle, settings, enabled };

  const placeBar = useCallback((id: number, loading = false) => {
    const view = safeView(editor);
    const ghost = view ? currentGhost(view.state) : null;
    if (!view || !ghost) return setBar(null);
    const widget = view.dom.querySelector('.ce-ghost-text') as HTMLElement | null;
    const coords = view.coordsAtPos(ghost.pos);
    // Just under the last line of the grey text, lined up with the paragraph.
    const lines = widget ? Array.from(widget.getClientRects()) : [];
    const bottom = lines.length ? lines[lines.length - 1].bottom : coords.bottom;
    const paragraph = widget?.closest('.bn-block-content') as HTMLElement | null;
    const left = paragraph ? paragraph.getBoundingClientRect().left : coords.left;
    const result = resultRef.current.get(id);
    // Under the text; the page scrolls to make room (see request). Kept on screen while it scrolls.
    const BAR_HEIGHT = 44;
    const top = Math.min(bottom + 8, window.innerHeight - BAR_HEIGHT - 8);
    setBar({ id, top, left: Math.min(window.innerWidth - 440, Math.max(8, left)), loading, manual: Boolean(result?.manual), heading: result?.heading ?? null });
  }, [editor]);

  // The bar is fixed on screen: keep it with the text while the page scrolls or resizes.
  const barId = bar?.id;
  useEffect(() => {
    if (barId === undefined) return undefined;
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => placeBar(barId));
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [barId, placeBar]);

  const accept = useCallback((ghostId?: number) => {
    const view = safeView(editor);
    if (!view) return;
    const ghost = currentGhost(view.state);
    const id = ghostId ?? ghost?.id;
    const result = id !== undefined ? resultRef.current.get(id) : undefined;
    if (!ghost || !result) return;
    clearGhost(view);
    setBar(null);
    const [inline] = aiTextToInline(result.text.trimEnd(), new Map(), result.sources, optionsRef.current.makeCitations);
    if (!inline?.length && !result.heading) return;
    // Keep the leading space the model gave (aiTextToInline trims paragraph edges).
    if (inline?.length && /^\s/.test(result.text) && inline[0]?.type === 'text') inline[0] = { ...inline[0], text: ` ${inline[0].text}` };
    if (inline?.length) editor.insertInlineContent(inline);
    // Conclude: the next section's heading after this paragraph, and the cursor ready under it.
    if (result.heading) {
      try {
        const current = editor.getTextCursorPosition().block;
        const top = editor.document as any[];
        const index = top.findIndex((block) => block.id === current.id);
        const previousHeading = [...top.slice(0, Math.max(0, index))].reverse().find((block) => block.type === 'heading');
        const level = Math.min(3, Math.max(2, Number(previousHeading?.props?.level) || 2));
        const inserted = editor.insertBlocks(
          [{ type: 'heading', props: { level }, content: result.heading }, { type: 'paragraph', content: '' }] as any,
          current,
          'after',
        );
        if (inserted[1]) editor.setTextCursorPosition(inserted[1], 'start');
      } catch {
        // The paragraph moved meanwhile; the conclusion is in, the heading can be added by hand.
      }
    }
    if (result.title) optionsRef.current.onTitle?.(result.title);
    moduleAnalytics.track({ module: 'ai_editor', feature: 'autocomplete', event_name: 'accepted', metadata: { citations: result.sources.length } });
    optionsRef.current.onAccepted?.({ words: (result.text.match(/\S+/g) || []).length, manual: result.manual });
  }, [editor]);

  const dismiss = useCallback(() => {
    clearGhost(safeView(editor));
    setBar(null);
  }, [editor]);

  // The plugin itself is installed with the editor (editorExtension.ts); these are its callbacks.
  const pluginHandlers = useMemo(
    () => ({
      onAccept: (ghost: { id: number }) => accept(ghost.id),
      onDismiss: () => setBar(null),
    }),
    [accept],
  );

  const request = useCallback(async ({ refine, manual = false, conclude = false }: RequestOptions = {}) => {
    const view = safeView(editor);
    if (!view || (!manual && (!optionsRef.current.enabled || pausedRef.current || !view.hasFocus()))) return;
    // Never while a "/" or "@" menu is open: what is typed there is a search, not prose.
    if (view.dom.querySelector('.bn-suggestion-decorator')) return;
    const { state } = view;
    const { selection } = state;
    if (!selection.empty) return;
    const $pos = selection.$from;
    const parent = $pos.parent;
    if (!parent.isTextblock || parent.type.spec.code) return;
    // Not in the reference list the editor keeps (References heading and entries).
    if (String(parent.attrs?.ceRole || '').startsWith('bibliography')) return;
    const atEnd = $pos.parentOffset === parent.content.size;
    // On its own: only at the end of a paragraph that has some words. Asked for
    // ("AI suggest"): anywhere the cursor is.
    if (!manual && !atEnd) return;
    const fullText = textOf(parent);
    const current = atEnd ? fullText : parent.textBetween(0, $pos.parentOffset, ' ', ' ');
    const after = atEnd ? '' : parent.textBetween($pos.parentOffset, parent.content.size, ' ', ' ');
    if (!manual && current.trim().split(/\s+/).length < 4 && !refine) return;
    const container = $pos.node(Math.max(0, $pos.depth - 1));
    if (container?.type?.name === 'blockContainer') {
      const content = $pos.parent;
      if (content.type.name === 'heading') return;
    }
    // Text before the cursor: up to ~2,500 characters of preceding blocks.
    let before = '';
    let sectionTitle = '';
    state.doc.nodesBetween(0, selection.from, (node: any, pos: number) => {
      if (node.isTextblock) {
        const text = pos + node.nodeSize <= selection.from ? textOf(node) : current;
        if (node.type.name === 'heading') sectionTitle = text;
        before += `${text}\n`;
        return false;
      }
      return true;
    });
    before = before.trimEnd().slice(-2500);
    const key = `${selection.from}:${before.slice(-200)}`;
    const now = Date.now();
    if (!refine && !manual && (key === lastRequestRef.current.key || now - lastRequestRef.current.at < MIN_GAP_MS)) return;
    lastRequestRef.current = { at: now, key };
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const pos = selection.from;
    const shapeAtRequest = paragraphShape(state, pos);
    const outline: string[] = [];
    let nextSectionExists = false;
    if (conclude) {
      state.doc.descendants((node: any, nodePos: number) => {
        if (node.type.name === 'heading') {
          const heading = textOf(node).trim();
          // The generated reference list is not a section the writer still has to write.
          if (/^(references|reference list|bibliography|works cited|sources)$/i.test(heading)) return false;
          outline.push(heading.slice(0, 200));
          if (nodePos > pos) nextSectionExists = true;
        }
        return !node.isTextblock;
      });
    }
    if (manual) {
      const coords = view.coordsAtPos(pos);
      setWritingAt({ top: coords.top, left: coords.left });
    }
    try {
      const response = await autocomplete(
        {
          before,
          after: after || undefined,
          documentTitle: optionsRef.current.documentTitle,
          sectionTitle,
          cite: true,
          refine,
          length: conclude ? 'conclude' : manual ? 'paragraph' : 'sentence',
          settings: optionsRef.current.settings,
          outline: conclude ? outline.slice(0, 200) : undefined,
          nextSectionExists: conclude ? nextSectionExists : undefined,
        },
        controller.signal,
      );
      // Still useful only if the cursor's paragraph is as it was and the cursor has not moved
      // within it. The rest of the document may have changed meanwhile (citation labels, the
      // reference list), which can shift where the cursor is: show the suggestion there.
      const latest = safeView(editor);
      if (!latest || !latest.state.selection.empty) return;
      const at = latest.state.selection.from;
      if (paragraphShape(latest.state, at) !== shapeAtRequest) return;
      if (!response.text.trim() && !response.heading) {
        // Asked for (AI suggest, Conclude): say so instead of the writing flag just disappearing.
        // Mid-sentence the model often only repeats the words after the cursor, which are cut.
        if (manual) toast(after ? 'Nothing new to add here. Try AI suggest at the end of a sentence.' : 'No suggestion this time. Try again.');
        return;
      }
      const id = ++counterRef.current;
      resultRef.current.set(id, { text: response.text, sources: response.sources, before, manual, conclude, heading: response.heading, title: response.title });
      if (resultRef.current.size > 20) resultRef.current.delete(resultRef.current.keys().next().value as number);
      showGhost(latest, at, previewAIText(response.text, new Map(), response.sources) || ' ', id);
      // Room for the grey text and its bar under it: scroll the page up when they would be cut off.
      const widget = latest.dom.querySelector('.ce-ghost-text') as HTMLElement | null;
      let scroller: HTMLElement | null = widget?.parentElement ?? null;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      const lines = widget ? widget.getClientRects() : null;
      if (scroller && lines?.length) {
        const overflow = lines[lines.length - 1].bottom + 64 - scroller.getBoundingClientRect().bottom;
        if (overflow > 0) scroller.scrollBy({ top: overflow, behavior: 'smooth' });
      }
      window.requestAnimationFrame(() => placeBar(id));
      moduleAnalytics.track({ module: 'ai_editor', feature: 'autocomplete', event_name: 'shown', duration_ms: response.ms });
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      if (caught instanceof AssistError && caught.outOfCredits) {
        pausedRef.current = true;
        optionsRef.current.onOutOfCredits();
      } else if (manual) {
        toast.error((caught as Error).message || 'AI suggest is unavailable right now.');
      }
    } finally {
      if (manual && abortRef.current === controller) setWritingAt(null);
    }
  }, [editor, placeBar]);

  /** "AI suggest": two or three sentences at the cursor now, as grey text with Accept. */
  const suggestHere = useCallback(() => {
    clearGhost(safeView(editor));
    setBar(null);
    void request({ manual: true });
  }, [editor, request]);

  /** Conclude: accept what is shown, then a closing statement (and the next heading) as grey text. */
  const conclude = useCallback(() => {
    const view = safeView(editor);
    if (view && currentGhost(view.state)) accept();
    else {
      clearGhost(view);
      setBar(null);
    }
    window.setTimeout(() => void request({ manual: true, conclude: true }), 0);
  }, [accept, editor, request]);

  const refine = useCallback(() => {
    const view = safeView(editor);
    const ghost = view ? currentGhost(view.state) : null;
    const previous = ghost ? resultRef.current.get(ghost.id) : undefined;
    clearGhost(view);
    setBar(null);
    void request({ refine: previous?.text || ' ', manual: previous?.manual, conclude: previous?.conclude });
  }, [editor, request]);

  const feedback = useCallback((value: 'up' | 'down') => {
    moduleAnalytics.track({ module: 'ai_editor', feature: 'autocomplete', event_name: value === 'up' ? 'thumbs_up' : 'thumbs_down' });
    if (value === 'down') dismiss();
  }, [dismiss]);

  // Typing schedules a request after a pause; any change hides the old suggestion's bar.
  useEffect(() => {
    if (!editor) return undefined;
    const schedule = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setBar((current) => (current ? null : current));
      if (!optionsRef.current.enabled) return;
      timerRef.current = window.setTimeout(() => void request(), IDLE_MS);
      setWritingAt(null);
    };
    const unsubscribe = editor.onChange?.(schedule);
    const resume = () => {
      pausedRef.current = false;
    };
    window.addEventListener('credits-updated', resume);
    return () => {
      unsubscribe?.();
      window.removeEventListener('credits-updated', resume);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [editor, request]);

  useEffect(() => {
    if (!enabled) dismiss();
  }, [dismiss, enabled]);

  return { bar, writingAt, accept, dismiss, refine, feedback, suggestHere, conclude, pluginHandlers };
}
