'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuX } from 'react-icons/lu';
import type { WordSettings } from '../../lib/aiEditor/wordSchema';

const PAPERS = [
  { id: 'a4', label: 'A4 (21 × 29.7 cm)', width: 595.3, height: 841.9 },
  { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 612, height: 792 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', width: 612, height: 1008 },
  { id: 'a5', label: 'A5 (14.8 × 21 cm)', width: 419.5, height: 595.3 },
];

const MARGIN_PRESETS = [
  { label: 'Normal', cm: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 } },
  { label: 'Narrow', cm: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
  { label: 'Moderate', cm: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 } },
  { label: 'Wide', cm: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 } },
  { label: 'Thesis (binding)', cm: { top: 2.54, bottom: 2.54, left: 3.81, right: 2.54 } },
];

type PageNumbers = 'none' | 'footer-center' | 'footer-right' | 'header-right';

const PT_PER_CM = 72 / 2.54;
const toCm = (pt: unknown, fallback: number) => {
  const number = Number.parseFloat(String(pt ?? ''));
  return Math.round(((Number.isFinite(number) ? number : fallback * PT_PER_CM) / PT_PER_CM) * 100) / 100;
};
const toPt = (cm: number) => (Math.round(cm * PT_PER_CM * 10) / 10).toString();

function stripPage(text: string) {
  return text.replace(/\s*(Page\s*)?\{PAGE\}(\s*of\s*\{PAGES\})?\s*/gi, ' ').trim();
}

type Props = {
  isOpen: boolean;
  canEdit: boolean;
  settings: WordSettings | null | undefined;
  onClose: () => void;
  onSave: (next: WordSettings) => void;
};

/** Word's page setup: paper, orientation, margins, header, footer and page numbers. */
export default function WordPageSetupDialog({ isOpen, canEdit, settings, onClose, onSave }: Props) {
  const initial = useMemo(() => {
    const page = settings?.page || {};
    const width = Number.parseFloat(String(page.widthPt ?? '595.3'));
    const height = Number.parseFloat(String(page.heightPt ?? '841.9'));
    const landscape = (page.orientation === 'landscape') || width > height;
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    const paper = PAPERS.find((item) => Math.abs(item.width - short) < 3 && Math.abs(item.height - long) < 3)?.id || 'a4';
    const margins = page.margins || {};
    const header = settings?.header?.default?.text || '';
    const footer = settings?.footer?.default?.text || '';
    let numbers: PageNumbers = 'none';
    if (/\{PAGE\}/.test(footer)) numbers = settings?.footer?.default?.align === 'right' ? 'footer-right' : 'footer-center';
    else if (/\{PAGE\}/.test(header)) numbers = 'header-right';
    return {
      paper,
      landscape,
      margins: {
        top: toCm(margins.top, 2.54), bottom: toCm(margins.bottom, 2.54),
        left: toCm(margins.left, 2.54), right: toCm(margins.right, 2.54),
      },
      header: stripPage(header),
      footer: stripPage(footer),
      numbers,
      differentFirst: Boolean(settings?.differentFirstPage),
    };
  }, [settings]);
  const [state, setState] = useState(initial);
  useEffect(() => {
    if (isOpen) setState(initial);
  }, [initial, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const paper = PAPERS.find((item) => item.id === state.paper) || PAPERS[0];
  const pageWidth = state.landscape ? paper.height : paper.width;
  const pageHeight = state.landscape ? paper.width : paper.height;
  const scale = 150 / Math.max(pageWidth, pageHeight);

  const save = () => {
    const headerText = state.numbers === 'header-right' ? `${state.header}${state.header ? '\t' : ''}{PAGE}`.trim() : state.header;
    const footerText = state.numbers.startsWith('footer') ? `${state.footer}${state.footer ? ' · ' : ''}{PAGE}`.trim() : state.footer;
    const page = settings?.page || {};
    onSave({
      ...(settings || {}),
      version: 1,
      page: {
        ...page,
        widthPt: String(pageWidth),
        heightPt: String(pageHeight),
        orientation: state.landscape ? 'landscape' : 'portrait',
        margins: {
          ...(page.margins || {}),
          top: toPt(state.margins.top), bottom: toPt(state.margins.bottom),
          left: toPt(state.margins.left), right: toPt(state.margins.right),
          header: page.margins?.header || '36', footer: page.margins?.footer || '36',
        },
      },
      header: headerText ? { ...(settings?.header || {}), default: { text: headerText, align: state.numbers === 'header-right' ? 'right' : (settings?.header?.default?.align || 'left') } } : {},
      footer: footerText ? { ...(settings?.footer || {}), default: { text: footerText, align: state.numbers === 'footer-right' ? 'right' : 'center' } } : {},
      differentFirstPage: state.differentFirst,
    });
  };

  const field = 'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm outline-none focus:border-[#1d4ed8] disabled:bg-[#f8fafc]';

  // On the page root: the header is its own stacking layer, under the editor's pop-ups.
  return createPortal(
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,0.35)] p-4" role="dialog" aria-modal="true" aria-label="Page setup">
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between border-b border-[#f1f5f9] px-6 py-4">
          <div>
            <h2 className="text-[18px] font-bold text-[#0f172a]">Page setup</h2>
            <p className="text-[13px] text-[#64748b]">Used on screen and in the Word and PDF files.</p>
          </div>
          <button type="button" aria-label="Close page setup" onClick={onClose} className="rounded-full p-2 text-[#64748b] hover:bg-[#f1f5f9]">
            <LuX className="h-5 w-5" />
          </button>
        </div>
        <div className="grid flex-1 gap-6 overflow-y-auto px-6 py-5 sm:grid-cols-[1fr_170px]">
          <div className="space-y-4">
            <label className="block text-[13px] font-medium text-[#334155]">
              Paper size
              <select className={`${field} mt-1`} value={state.paper} disabled={!canEdit} onChange={(event) => setState({ ...state, paper: event.target.value })}>
                {PAPERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <fieldset disabled={!canEdit}>
              <legend className="text-[13px] font-medium text-[#334155]">Orientation</legend>
              <div className="mt-1 flex gap-2">
                {[false, true].map((landscape) => (
                  <button
                    key={String(landscape)}
                    type="button"
                    aria-pressed={state.landscape === landscape}
                    onClick={() => setState({ ...state, landscape })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${state.landscape === landscape ? 'border-[#1d4ed8] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[#e5e7eb] text-[#334155]'}`}
                  >
                    {landscape ? 'Landscape' : 'Portrait'}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={!canEdit}>
              <legend className="text-[13px] font-medium text-[#334155]">Margins (cm)</legend>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {MARGIN_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setState({ ...state, margins: { ...preset.cm } })}
                    className="rounded-full border border-[#e5e7eb] px-2.5 py-1 text-[12px] text-[#334155] hover:border-[#1d4ed8]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                  <label key={side} className="text-[12px] capitalize text-[#64748b]">
                    {side}
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.01}
                      className={`${field} mt-0.5 px-2`}
                      value={state.margins[side]}
                      onChange={(event) => setState({ ...state, margins: { ...state.margins, [side]: Number(event.target.value) || 0 } })}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-[13px] font-medium text-[#334155]">
              Header
              <input className={`${field} mt-1`} disabled={!canEdit} value={state.header} placeholder="e.g. Running head: SHORT TITLE" onChange={(event) => setState({ ...state, header: event.target.value })} />
            </label>
            <label className="block text-[13px] font-medium text-[#334155]">
              Footer
              <input className={`${field} mt-1`} disabled={!canEdit} value={state.footer} placeholder="Optional" onChange={(event) => setState({ ...state, footer: event.target.value })} />
            </label>
            <label className="block text-[13px] font-medium text-[#334155]">
              Page numbers
              <select className={`${field} mt-1`} disabled={!canEdit} value={state.numbers} onChange={(event) => setState({ ...state, numbers: event.target.value as PageNumbers })}>
                <option value="none">None</option>
                <option value="footer-center">Bottom, centred</option>
                <option value="footer-right">Bottom, right</option>
                <option value="header-right">Top, right</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#334155]">
              <input type="checkbox" disabled={!canEdit} checked={state.differentFirst} onChange={(event) => setState({ ...state, differentFirst: event.target.checked })} />
              Different first page (no header or number on the title page)
            </label>
          </div>
          <div className="hidden sm:block" aria-hidden="true">
            <div className="text-[12px] text-[#64748b]">Preview</div>
            <div className="relative mt-2 border border-[#e5e7eb] bg-white shadow-sm" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
              <div
                className="absolute border border-dashed border-[#bfdbfe] bg-[#eff6ff]"
                style={{
                  top: state.margins.top * PT_PER_CM * scale,
                  bottom: state.margins.bottom * PT_PER_CM * scale,
                  left: state.margins.left * PT_PER_CM * scale,
                  right: state.margins.right * PT_PER_CM * scale,
                }}
              />
              {state.header || state.numbers === 'header-right' ? (
                <div className="absolute left-0 right-0 truncate px-2 text-[7px] text-[#64748b]" style={{ top: 6, textAlign: state.numbers === 'header-right' ? 'right' : 'left' }}>
                  {state.header}{state.numbers === 'header-right' ? ' 1' : ''}
                </div>
              ) : null}
              {state.footer || state.numbers.startsWith('footer') ? (
                <div className="absolute left-0 right-0 truncate px-2 text-[7px] text-[#64748b]" style={{ bottom: 6, textAlign: state.numbers === 'footer-right' ? 'right' : 'center' }}>
                  {state.footer}{state.numbers.startsWith('footer') ? ' 1' : ''}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#f1f5f9] px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-[#334155] hover:bg-[#f1f5f9]">Cancel</button>
          {canEdit ? (
            <button type="button" onClick={save} className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">Save</button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
