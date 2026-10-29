'use client';

import { toast } from 'react-hot-toast';
import { editorPath, navLink, useEditorConfig } from '../../runtime';
import type { AutocompleteSettings } from '../../lib/aiEditor/assistApi';
import { getDocuments, getFolders } from '../../utils/libraryApi';
import { isPaidPlan, useEditorAccount } from '../../lib/aiEditor/account';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Block, BlockNoteEditor } from '@blocknote/core';
import { LuAlignCenter, LuAlignJustify, LuAlignLeft, LuAlignRight, LuArrowDownUp, LuArrowLeft, LuBaseline, LuBold, LuCheck, LuChevronDown, LuChevronRight, LuChevronUp, LuCloud, LuCopy, LuDownload, LuEllipsisVertical, LuEye, LuFileText, LuFolder, LuFolderInput, LuGlobe, LuHistory, LuImage, LuIndentDecrease, LuIndentIncrease, LuItalic, LuLibrary, LuLink, LuList, LuListChecks, LuListOrdered, LuMenu, LuMessageSquare, LuMessageSquarePlus, LuMinus, LuPaintBucket, LuPaintbrush, LuPencil, LuPlus, LuPrinter, LuQuote, LuRedo2, LuRefreshCw, LuRemoveFormatting, LuSearch, LuSettings, LuShieldCheck, LuSlidersHorizontal, LuSparkles, LuSpellCheck, LuStrikethrough, LuSubscript, LuSuperscript, LuText, LuType, LuUnderline, LuUndo2, LuUsers, LuWrench, LuX, LuZap } from 'react-icons/lu';
import type {
  AIEditorAccessRole,
  AIEditorCollaborator,
  AIEditorDocumentMember,
} from '../../types/ai-editor';
import CitationStyleSelector from '../ResearchAgent/CitationStyleSelector';
import WordPageSetupDialog from './WordPageSetupDialog';
import { changeIndent, setParagraphProps } from '../../lib/aiEditor/paragraphFormat';
import { WORD_OPENABLE, exportWordDocument, importWordFile } from '../../lib/aiEditor/wordApi';
import type { WordSettings } from '../../lib/aiEditor/wordSchema';
import { editorConfirm, editorPrompt } from '../../lib/aiEditor/editorDialogs';
import FindReplaceBar, { FIND_CSS } from './FindReplaceBar';

const DOCUMENT_LANGUAGES: { label: string; code: string }[] = [
  { label: 'English', code: 'en' }, { label: 'English (UK)', code: 'en-GB' }, { label: 'French', code: 'fr' },
  { label: 'Spanish', code: 'es' }, { label: 'Portuguese', code: 'pt' }, { label: 'German', code: 'de' },
  { label: 'Italian', code: 'it' }, { label: 'Dutch', code: 'nl' }, { label: 'Swahili', code: 'sw' },
  { label: 'Arabic', code: 'ar' }, { label: 'Chinese', code: 'zh' }, { label: 'Hindi', code: 'hi' },
  { label: 'Indonesian', code: 'id' }, { label: 'Japanese', code: 'ja' }, { label: 'Korean', code: 'ko' },
  { label: 'Russian', code: 'ru' }, { label: 'Turkish', code: 'tr' },
];
import { preprocessRichDocumentHtml } from '../../utils/googleDocsHtmlForBlockNote';
import { getHost } from '../../helpers/getHost';
import { postDurableArtifactForm } from '../../utils/jobsApi';

type GoogleDocsHeaderProps = {
  documentId?: string | null;
  /** Word page setup, headers/footers and styles (exported with the document). */
  wordSettings?: WordSettings | null;
  onWordSettingsChange?: (next: WordSettings) => void;
  /** Comments go into the Word file as Word comments. */
  documentComments?: any[];
  isPageView?: boolean;
  onPageViewToggle?: () => void;
  editor?: BlockNoteEditor<any, any, any> | null;
  documentTitle: string;
  onDocumentTitleChange: (value: string) => void;
  documentStatusLabel: string;
  collaborators: AIEditorCollaborator[];
  sharedMembers: AIEditorDocumentMember[];
  isLinkSharingEnabled: boolean;
  currentUserDisplayName: string;
  activeRole: AIEditorAccessRole;
  canEdit: boolean;
  onShareClick: () => void;
  onCopyLinkClick: () => void;
  onPrintClick?: () => void;
  onVersionHistoryClick: () => void;
  onDocsHomeClick?: () => void;
  onCreateDocumentClick?: () => void;
  onDuplicateDocumentClick?: () => void;
  onDeleteDocumentClick?: () => void;
  onMainMenuClick?: () => void;
  autocompleteSettings?: AutocompleteSettings;
  onAutocompleteSettingsChange?: (settings: AutocompleteSettings) => void;
  /** The left app nav is folded away: show the menu button on wide screens too. */
  isNavCollapsed?: boolean;
  isStarred?: boolean;
  onStarToggle?: () => void;
  isOutlinePanelVisible?: boolean;
  onOutlineToggle?: () => void;
  canComment?: boolean;
  onCommentClick?: () => void;
  onShowCommentsClick?: () => void;
  /** Opens the AI Chat / Comments / Library / Find papers panel. */
  onOpenAssistant?: (tab: 'chat' | 'comments' | 'review' | 'library' | 'papers') => void;
  onInsertCitation?: () => void;
  onInsertInlineEquation?: () => void;
  onBookmarkClick?: () => void;
  editingModeValue?: 'Editing' | 'Suggesting' | 'Viewing';
  onEditingModeChange?: (value: 'Editing' | 'Suggesting' | 'Viewing') => void;
  pageWidthPx?: number;
  onPageWidthChange?: (value: number) => void;
  zoomValue?: string;
  onZoomChange?: (value: string) => void;
  spellCheckEnabled?: boolean;
  onSpellCheckToggle?: () => void;
  citationStyle?: string;
  onCitationStyleChange?: (value: string) => void;
  aiWritingSuggestionsEnabled?: boolean;
  onToggleAIWritingSuggestions?: () => void;
  aiReviewSuggestionsEnabled?: boolean;
  onToggleAIReviewSuggestions?: () => void;
  onStartWritingClick?: () => void;
  isAIWritingActive?: boolean;
  isAIWritingLoading?: boolean;
  humanScore?: number | null;
  flaggedCount?: number;
  onViewAndHumanizeClick?: () => void;
  articleViewAction?: React.ReactNode;
  /** "Review": an AI review of the whole document, shown in the Comments panel. */
  onReviewClick?: () => void;
  isAssistantOpen?: boolean;
  onToggleAssistant?: () => void;
};

type MenuItem = {
  label: string;
  shortcut?: string;
  description?: string;
  selected?: boolean;
  dividerAfter?: boolean;
};

type CitationEntry = {
  id: string;
  label: string;
  url?: string;
};

type StoredListVariants = {
  bullet: Record<string, 'standard' | 'hollow' | 'diamond'>;
  numbered: Record<string, 'standard' | 'bracket' | 'roman'>;
  checklist: Record<string, 'checklist' | 'subtasks'>;
};

type DocsBlock = Block<any, any, any>;
type DocsEditor = BlockNoteEditor<any, any, any>;
type DocsTextAlignment = 'left' | 'center' | 'right' | 'justify';
type DocsListType = 'bulletListItem' | 'numberedListItem' | 'checkListItem';

function shallowEqualRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function getTargetBlocks(editor: DocsEditor): DocsBlock[] {
  const selectionBlocks = editor.getSelection()?.blocks ?? [];
  if (selectionBlocks.length > 0) {
    return selectionBlocks;
  }

  try {
    return [editor.getTextCursorPosition().block];
  } catch {
    return [];
  }
}

function getPrimarySelectedBlock(editor: DocsEditor): DocsBlock | null {
  return getTargetBlocks(editor)[0] ?? null;
}

function getTableHandles(editor: DocsEditor | null | undefined): any | null {
  return editor ? ((editor as any).tableHandles ?? null) : null;
}

function getTableHandlesState(tableHandles: any) {
  return tableHandles?.store?.state ?? tableHandles?.store?.getState?.() ?? null;
}

function getSelectedTableContext(editor: DocsEditor | null | undefined) {
  const tableHandles = getTableHandles(editor);
  const primaryBlock = editor ? getPrimarySelectedBlock(editor) : null;
  const tableState = getTableHandlesState(tableHandles);
  const block =
    primaryBlock?.type === 'table'
      ? primaryBlock
      : tableState?.block?.type === 'table'
        ? tableState.block
        : null;
  const selection = tableHandles?.getCellSelection?.() ?? null;
  const anchor = selection?.from ?? selection?.cells?.[0] ?? null;

  return {
    block,
    tableHandles,
    selection,
    anchor,
  };
}

function getStyleLabelFromBlock(block: DocsBlock | null): string {
  if (!block) {
    return 'Normal text';
  }

  if (block.type === 'heading') {
    const level = typeof block.props.level === 'number' ? block.props.level : 1;
    return `Heading ${level}`;
  }

  return 'Normal text';
}

function getPlainTextFromBlockContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (!item || typeof item !== 'object') {
        return '';
      }

      const inline = item as {
        text?: string;
        content?: Array<{ text?: string } | string>;
        type?: string;
        props?: { displayText?: string };
      };

      if (typeof inline.text === 'string') {
        return inline.text;
      }

      if (inline.type === 'aiCitation') {
        return inline.props?.displayText || '';
      }

      if (Array.isArray(inline.content)) {
        return inline.content
          .map((child) => {
            if (typeof child === 'string') {
              return child;
            }

            return typeof child?.text === 'string' ? child.text : '';
          })
          .join('');
      }

      return '';
    })
    .join('');
}

function normalizeTextContent(value: string | null | undefined) {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function downloadBlob(blob: Blob, filename: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function createExportFilename(title: string, extension: string) {
  const base = (title || 'document')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'document'}.${extension}`;
}

function getFontFamilyLabel(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const [family] = value.split(',');
  return family?.trim().replace(/^['"]|['"]$/g, '') || null;
}

function getFontSizeLabel(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? value;
}

function getFontWeightValue(variant: string | undefined) {
  switch ((variant ?? '').toLowerCase()) {
    case 'light':
      return '300';
    case 'medium':
      return '500';
    case 'semibold':
      return '600';
    case 'bold':
      return '700';
    case 'black':
      return '900';
    case 'regular':
    default:
      return '400';
  }
}

function normalizeFontSizeValue(value: string) {
  if (value.endsWith('pt') || value.endsWith('px')) {
    return value.endsWith('px') ? `${value.slice(0, -2)}pt` : value;
  }

  return `${value}pt`;
}

function getToolbarTextColor(value: string | undefined) {
  if (!value || value === 'default') {
    return '#000000';
  }

  return value;
}

function getToolbarHighlightColor(value: string | undefined) {
  if (!value || value === 'default') {
    return 'transparent';
  }

  return value;
}

function normalizeLineSpacingValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '1.15';
  }

  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : '1.15';
}

const LIST_VARIANT_STYLE_ELEMENT_ID = 'ai-editor-list-variant-styles';

// Escapes a value for use inside a double-quoted CSS string or attribute selector.
function cssStringValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ');
}

function toRomanNumeral(value: number) {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];

  let remaining = Math.max(1, Math.floor(value));
  let result = '';

  numerals.forEach(([amount, symbol]) => {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  });

  return result;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  return haystack.split(needle).length - 1;
}

function replaceInlineContentText(content: any, search: string, replacement: string): { nextContent: any; replaced: number } {
  if (!Array.isArray(content)) {
    return { nextContent: content, replaced: 0 };
  }

  let replaced = 0;

  const nextContent = content.map((item) => {
    if (item?.type === 'text' && typeof item.text === 'string') {
      const hits = countOccurrences(item.text, search);
      if (!hits) {
        return item;
      }

      replaced += hits;
      return {
        ...item,
        text: item.text.split(search).join(replacement),
      };
    }

    if (item?.type === 'link' && Array.isArray(item.content)) {
      const nested = replaceInlineContentText(item.content, search, replacement);
      replaced += nested.replaced;
      return {
        ...item,
        content: nested.nextContent,
      };
    }

    return item;
  });

  return { nextContent, replaced };
}

function getAlignmentIcon(alignment: DocsTextAlignment) {
  switch (alignment) {
    case 'center':
      return <LuAlignCenter className="h-[18px] w-[18px]" />;
    case 'right':
      return <LuAlignRight className="h-[18px] w-[18px]" />;
    case 'justify':
      return <LuAlignJustify className="h-[18px] w-[18px]" />;
    case 'left':
    default:
      return <LuAlignLeft className="h-[18px] w-[18px]" />;
  }
}

const DOWNLOAD_DOCX_LABEL = 'Download Word';
const DOWNLOAD_PDF_LABEL = 'Download PDF';
const DOWNLOAD_LATEX_LABEL = 'Download LaTeX';
const DOWNLOAD_TEXT_LABEL = 'Download text';

const topMenus = ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Citations'];

// Every item here has a handler in handleTopMenuItemSelect.
const topMenuItems: Record<string, MenuItem[]> = {
  File: [
    { label: 'New', shortcut: 'Ctrl+Alt+N' },
    { label: 'Open', shortcut: 'Ctrl+O' },
    { label: 'Open in new tab' },
    { label: 'Make a copy', dividerAfter: true },
    { label: 'Share' },
    { label: 'Copy link' },
    { label: 'Email collaborators' },
    { label: 'Star', description: 'Keep it at the top of your documents', dividerAfter: true },
    { label: 'Import from file', description: 'Word, HTML, Markdown or text' },
    { label: DOWNLOAD_DOCX_LABEL, description: 'Microsoft Word document' },
    { label: DOWNLOAD_PDF_LABEL, description: 'PDF document' },
    { label: DOWNLOAD_LATEX_LABEL, description: 'For Overleaf: .tex, .bib and figures' },
    { label: DOWNLOAD_TEXT_LABEL, description: 'Text only, no formatting' },
    { label: 'Copy document', description: 'Copy everything to the clipboard', dividerAfter: true },
    { label: 'Rename', shortcut: 'F2' },
    { label: 'Move to trash', dividerAfter: true },
    { label: 'Version history', description: 'See version history' },
    { label: 'Details' },
    { label: 'Language', description: 'Document language' },
    { label: 'Page setup' },
    { label: 'Print', shortcut: 'Ctrl+P' },
  ],
  Edit: [
    { label: 'Undo', shortcut: 'Ctrl+Z' },
    { label: 'Redo', shortcut: 'Ctrl+Y', dividerAfter: true },
    { label: 'Cut', shortcut: 'Ctrl+X' },
    { label: 'Copy', shortcut: 'Ctrl+C' },
    { label: 'Copy as Markdown' },
    { label: 'Paste', shortcut: 'Ctrl+V' },
    { label: 'Paste without formatting', shortcut: 'Ctrl+Shift+V' },
    { label: 'Paste from Markdown', dividerAfter: true },
    { label: 'Select all', shortcut: 'Ctrl+A' },
    { label: 'Delete', dividerAfter: true },
    { label: 'Find and replace', shortcut: 'Ctrl+H' },
    { label: 'Find', shortcut: 'Ctrl+F', dividerAfter: true },
    { label: 'Clear formatting', shortcut: 'Ctrl+\\' },
  ],
  View: [
    { label: 'Mode', description: 'Editing, suggesting, viewing' },
    { label: 'Comments', description: 'Show comments' },
    { label: 'Show document outline' },
    { label: 'Print layout', description: 'Pages with headers, footers and footnotes', dividerAfter: true },
    { label: 'Full screen', shortcut: 'Ctrl+Shift+F', dividerAfter: true },
    { label: 'Fit', description: 'Fit the page to the window' },
    { label: 'Zoom reset', description: '100%' },
  ],
  Insert: [
    { label: 'Image', description: 'Upload from computer or URL' },
    { label: 'Table', shortcut: 'Ctrl+Alt+T' },
    { label: 'Horizontal line' },
    { label: 'Attachment', description: 'Attach a file', dividerAfter: true },
    { label: 'Link', shortcut: 'Ctrl+K' },
    { label: 'Bookmark' },
    { label: 'Page break', shortcut: 'Ctrl+Enter' },
    { label: 'Footnote', shortcut: 'Ctrl+Alt+F' },
    { label: 'Table of contents' },
    { label: 'Special characters' },
    { label: 'Inline equation' },
    { label: 'Equation', dividerAfter: true },
    { label: 'Comment', shortcut: 'Ctrl+Alt+M' },
  ],
  Format: [
    { label: 'Paragraph styles', description: 'Normal text, headings…' },
    { label: 'Align & indent' },
    { label: 'Line & paragraph spacing' },
    { label: 'Bullets & numbering', dividerAfter: true },
    { label: 'Clear formatting', shortcut: 'Ctrl+\\' },
  ],
  Tools: [
    { label: 'Spelling and grammar', shortcut: 'Ctrl+Alt+X', selected: true },
    { label: 'Word count', shortcut: 'Ctrl+Shift+C', dividerAfter: true },
    { label: 'Keyboard shortcuts', shortcut: 'Ctrl+/' },
  ],
  Citations: [
    { label: 'Insert citation', shortcut: '@' },
    { label: 'Find papers', description: 'Search 250M+ papers to cite' },
    { label: 'Library', description: 'Cite from your Library' },
  ],
};

// Phones list the menus in a sheet; these items open toolbar pop-ups that only exist on wider screens.
const desktopOnlyMenuItems = new Set(['Mode', 'Image', 'Special characters', 'Paragraph styles', 'Align & indent', 'Line & paragraph spacing', 'Bullets & numbering', 'Full screen', 'Fit', 'Zoom reset', 'Equation toolbar']);

const SECOND_ROW_DROPDOWNS = new Set([
  'select-zoom', 'select-font', 'select-font-size', 'toolbar-text-color', 'toolbar-highlight', 'toolbar-link-editor',
  'toolbar-insert-image', 'toolbar-more', 'toolbar-special-characters', 'select-align', 'select-spacing',
  'select-table-tools', 'select-checklist', 'select-bullets', 'select-numbers', 'select-mode',
]);

const zoomOptions = ['50%', '75%', '90%', '100%', '125%', '150%', '200%', 'Fit'];
const styleOptions = [
  'Normal text',
  'Title',
  'Subtitle',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Heading 4',
  'Heading 5',
  'Heading 6',
  'TOC heading',
];
/** Matches Google Docs font picker order; `submenu` = weight/style flyout (UI-only). */
const DOCS_FONT_CATALOG: {
  family: string;
  submenu?: boolean;
  variants?: string[];
}[] = [
  { family: 'Amatic SC' },
  { family: 'Arial' },
  { family: 'Caveat', submenu: true, variants: ['Regular', 'Bold'] },
  { family: 'Comfortaa', submenu: true, variants: ['Light', 'Regular', 'Bold'] },
  { family: 'Comic Sans MS' },
  { family: 'Courier New' },
  { family: 'EB Garamond', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Georgia' },
  { family: 'Impact' },
  { family: 'Lexend', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Lobster' },
  { family: 'Lora', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Merriweather', submenu: true, variants: ['Regular', 'Bold', 'Black'] },
  { family: 'Montserrat', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Nunito', submenu: true, variants: ['Regular', 'SemiBold', 'Bold'] },
  { family: 'Oswald', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Pacifico' },
  { family: 'Playfair Display', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Roboto', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Roboto Mono', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Roboto Serif', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Spectral', submenu: true, variants: ['Regular', 'Medium', 'Bold'] },
  { family: 'Times New Roman' },
  { family: 'Trebuchet MS' },
  { family: 'Verdana' },
];
const fontSizeOptions = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'];
const editingModeOptions: MenuItem[] = [
  { label: 'Editing', description: 'Edit the document directly', selected: true },
  { label: 'Suggesting', description: 'Propose edits as suggestions' },
  { label: 'Viewing', description: 'Preview without editing' },
];
const insertImageMenuItems: MenuItem[] = [
  { label: 'Upload from computer' },
  { label: 'By URL' },
  { label: 'Camera' },
];
const moreToolbarMenuItems: MenuItem[] = [
  { label: 'Copy formatting', shortcut: 'Ctrl+Alt+C' },
  { label: 'Clear formatting', shortcut: 'Ctrl+\\', dividerAfter: true },
  { label: 'Horizontal line' },
  { label: 'Page break', shortcut: 'Ctrl+Enter' },
  { label: 'Equation' },
  { label: 'Bookmark' },
  { label: 'Special characters' },
];
const specialCharacterItems = [
  '—',
  '–',
  '•',
  '…',
  '©',
  '®',
  '™',
  '§',
  '¶',
  '†',
  '‡',
  '°',
  '±',
  '×',
  '÷',
  '≠',
  '≤',
  '≥',
  '≈',
  '∞',
  '→',
  '←',
  '✓',
  '•',
  '€',
  '£',
  '¥',
  '¢',
];
const docsColorPalette: { label: string; hex: string }[] = [
  { label: 'Black', hex: '#000000' },
  { label: 'Dark gray 4', hex: '#434343' },
  { label: 'Dark gray 3', hex: '#666666' },
  { label: 'Dark gray 2', hex: '#999999' },
  { label: 'Dark gray 1', hex: '#b7b7b7' },
  { label: 'Gray', hex: '#cccccc' },
  { label: 'Light gray 1', hex: '#d9d9d9' },
  { label: 'Light gray 2', hex: '#efefef' },
  { label: 'Light gray 3', hex: '#f3f3f3' },
  { label: 'White', hex: '#ffffff' },
  { label: 'Red berry', hex: '#980000' },
  { label: 'Red', hex: '#ff0000' },
  { label: 'Orange', hex: '#ff9900' },
  { label: 'Yellow', hex: '#ffff00' },
  { label: 'Green', hex: '#00ff00' },
  { label: 'Cyan', hex: '#00ffff' },
  { label: 'Cornflower blue', hex: '#4a86e8' },
  { label: 'Blue', hex: '#0000ff' },
  { label: 'Purple', hex: '#9900ff' },
  { label: 'Magenta', hex: '#ff00ff' },
  { label: 'Light red berry 3', hex: '#e6b8af' },
  { label: 'Light red 3', hex: '#f4cccc' },
  { label: 'Light orange 3', hex: '#fce5cd' },
  { label: 'Light yellow 3', hex: '#fff2cc' },
  { label: 'Light green 3', hex: '#d9ead3' },
  { label: 'Light cyan 3', hex: '#d0e0e3' },
  { label: 'Light cornflower blue 3', hex: '#c9daf8' },
  { label: 'Light blue 3', hex: '#cfe2f3' },
  { label: 'Light purple 3', hex: '#d9d2e9' },
  { label: 'Light magenta 3', hex: '#ead1dc' },
  { label: 'Light red berry 2', hex: '#dd7e6b' },
  { label: 'Light red 2', hex: '#ea9999' },
  { label: 'Light orange 2', hex: '#f9cb9c' },
  { label: 'Light yellow 2', hex: '#ffe599' },
  { label: 'Light green 2', hex: '#b6d7a8' },
  { label: 'Light cyan 2', hex: '#a2c4c9' },
  { label: 'Light cornflower blue 2', hex: '#a4c2f4' },
  { label: 'Light blue 2', hex: '#9fc5e8' },
  { label: 'Light purple 2', hex: '#b4a7d6' },
  { label: 'Light magenta 2', hex: '#d5a6bd' },
  { label: 'Light red berry 1', hex: '#cc4125' },
  { label: 'Light red 1', hex: '#e06666' },
  { label: 'Light orange 1', hex: '#f6b26b' },
  { label: 'Light yellow 1', hex: '#ffd966' },
  { label: 'Light green 1', hex: '#93c47d' },
  { label: 'Light cyan 1', hex: '#76a5af' },
  { label: 'Light cornflower blue 1', hex: '#6d9eeb' },
  { label: 'Light blue 1', hex: '#6fa8dc' },
  { label: 'Light purple 1', hex: '#8e7cc3' },
  { label: 'Light magenta 1', hex: '#c27ba0' },
  { label: 'Dark red berry 1', hex: '#a61c00' },
  { label: 'Dark red 1', hex: '#cc0000' },
  { label: 'Dark orange 1', hex: '#e69138' },
  { label: 'Dark yellow 1', hex: '#f1c232' },
  { label: 'Dark green 1', hex: '#6aa84f' },
  { label: 'Dark cyan 1', hex: '#45818e' },
  { label: 'Dark cornflower blue 1', hex: '#3c78d8' },
  { label: 'Dark blue 1', hex: '#3d85c6' },
  { label: 'Dark purple 1', hex: '#674ea7' },
  { label: 'Dark magenta 1', hex: '#a64d79' },
  { label: 'Dark red berry 2', hex: '#85200c' },
  { label: 'Dark red 2', hex: '#990000' },
  { label: 'Dark orange 2', hex: '#b45f06' },
  { label: 'Dark yellow 2', hex: '#bf9000' },
  { label: 'Dark green 2', hex: '#38761d' },
  { label: 'Dark cyan 2', hex: '#134f5c' },
  { label: 'Dark cornflower blue 2', hex: '#1155cc' },
  { label: 'Dark blue 2', hex: '#0b5394' },
  { label: 'Dark purple 2', hex: '#351c75' },
  { label: 'Dark magenta 2', hex: '#741b47' },
  { label: 'Dark red berry 3', hex: '#5b0f00' },
  { label: 'Dark red 3', hex: '#660000' },
  { label: 'Dark orange 3', hex: '#783f04' },
  { label: 'Dark yellow 3', hex: '#7f6000' },
  { label: 'Dark green 3', hex: '#274e13' },
  { label: 'Dark cyan 3', hex: '#0c343d' },
  { label: 'Dark cornflower blue 3', hex: '#1c4587' },
  { label: 'Dark blue 3', hex: '#073763' },
  { label: 'Dark purple 3', hex: '#20124d' },
  { label: 'Dark magenta 3', hex: '#4c1130' },
];
const textColorSwatches = docsColorPalette;
const highlightSwatches = docsColorPalette;
const tableFillSwatches = [
  { label: 'None', hex: 'default' },
  { label: 'Light red', hex: '#f4cccc' },
  { label: 'Light orange', hex: '#fce5cd' },
  { label: 'Light yellow', hex: '#fff2cc' },
  { label: 'Light green', hex: '#d9ead3' },
  { label: 'Light cyan', hex: '#d0e0e3' },
  { label: 'Light blue', hex: '#cfe2f3' },
  { label: 'Light purple', hex: '#d9d2e9' },
  { label: 'Gray', hex: '#efefef' },
];
const alignMenuItems: MenuItem[] = [
  { label: 'Left', shortcut: 'Ctrl+Shift+L', selected: true },
  { label: 'Center', shortcut: 'Ctrl+Shift+E' },
  { label: 'Right', shortcut: 'Ctrl+Shift+R' },
  { label: 'Justify', shortcut: 'Ctrl+Shift+J' },
];
const lineSpacingMenuItems: MenuItem[] = [
  { label: 'Single' },
  { label: '1.15', selected: true },
  { label: '1.5' },
  { label: 'Double' },
  { label: 'Custom spacing', dividerAfter: true },
  { label: 'Add space before paragraph' },
  { label: 'Add space after paragraph' },
];
const keyboardShortcutGroups = [
  { label: 'Undo', shortcut: 'Ctrl+Z' },
  { label: 'Redo', shortcut: 'Ctrl+Y' },
  { label: 'Print document', shortcut: 'Ctrl+P' },
  { label: 'Insert link', shortcut: 'Ctrl+K' },
  { label: 'Select all', shortcut: 'Ctrl+A' },
  { label: 'Word count', shortcut: 'Ctrl+Shift+C' },
  { label: 'Add comment', shortcut: 'Ctrl+Alt+M' },
  { label: 'Search menus', shortcut: 'Alt+/' },
];
const checklistMenuItems: MenuItem[] = [
  { label: 'Checklist', selected: true },
  { label: 'Checklist with subtasks' },
];
const bulletMenuItems: MenuItem[] = [
  { label: 'Standard bullets', selected: true },
  { label: 'Hollow bullets' },
  { label: 'Diamond bullets' },
];
const numberedMenuItems: MenuItem[] = [
  { label: '1. 2. 3.', selected: true },
  { label: '1) 2) 3)' },
  { label: 'I. II. III.' },
];

const utilityButtons = [
  { id: 'undo', label: 'Undo (Ctrl+Z)', icon: <LuUndo2 className="h-[18px] w-[18px]" /> },
  { id: 'redo', label: 'Redo (Ctrl+Y)', icon: <LuRedo2 className="h-[18px] w-[18px]" /> },
  { id: 'print', label: 'Print (Ctrl+P)', icon: <LuPrinter className="h-[18px] w-[18px]" /> },
  { id: 'spellcheck', label: 'Spelling and grammar check (Ctrl+Alt+X)', icon: <LuSpellCheck className="h-[18px] w-[18px]" /> },
  { id: 'paint-format', label: 'Paint format', icon: <LuPaintbrush className="h-[18px] w-[18px]" /> },
];

const textInlineButtons = [
  { id: 'link', label: 'Insert link (Ctrl+K)', icon: <LuLink className="h-[18px] w-[18px]" /> },
  { id: 'comment', label: 'Add comment (Ctrl+Alt+M)', icon: <LuMessageSquarePlus className="h-[18px] w-[18px]" /> },
];

function HeaderIconButton({
  children,
  label,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] ${className}`}
    >
      {children}
    </button>
  );
}

function ToolbarIconButton({
  children,
  label,
  className = '',
  active = false,
  onClick,
  ariaPressed,
  disabled = false,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  active?: boolean;
  onClick?: () => void;
  ariaPressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={ariaPressed ?? active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[#f1f5f9] ${
        active ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)] hover:bg-[#dbeafe]' : 'text-[#475569] hover:text-[#0f172a]'
      } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

function ToolbarSelect({
  label,
  value,
  isOpen = false,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  value: string;
  isOpen?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={isOpen}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-[34px] shrink-0 items-center justify-between gap-2 rounded-[8px] px-2.5 text-[14px] text-[#334155] transition-colors hover:bg-[#f1f5f9] ${
        isOpen ? 'bg-[#f1f5f9] text-[#0f172a]' : ''
      } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''} ${className}`}
    >
      <span className="truncate">{value}</span>
      <ChevronDown />
    </button>
  );
}

function ToolbarDivider({ className = '' }: { className?: string }) {
  return <div className={`mx-1.5 h-[22px] w-px shrink-0 bg-[#e5e7eb] ${className}`} aria-hidden="true" />;
}

/** The mockup's small "⌄" after a select's value. */
function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 text-[#94a3b8] ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 18px line icon with the mockup's 1.8 stroke. */
function LineIcon({ children, className = 'h-[18px] w-[18px]' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICON_UNDO = <LineIcon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></LineIcon>;
const ICON_REDO = <LineIcon><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></LineIcon>;
const ICON_DOTS = <LineIcon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></LineIcon>;
const ICON_SHARE = <LineIcon><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></LineIcon>;
const ICON_REVIEW = <LineIcon><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></LineIcon>;
const ICON_BACK = <LineIcon className="h-[22px] w-[22px]"><path d="M15 18l-6-6 6-6" /></LineIcon>;
const ICON_SEARCH = <LineIcon className="h-4 w-4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></LineIcon>;
const ICON_PANEL = <LineIcon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></LineIcon>;

/** "Saved to server" and friends, shortened for the title row, with a status dot colour. */
function shortSaveState(label: string): { text: string; dot: string } {
  const value = label.toLowerCase();
  if (value.startsWith('saved')) return { text: 'Saved', dot: 'bg-[#16a34a]' };
  if (value.startsWith('saving')) return { text: 'Saving…', dot: 'bg-[#94a3b8] animate-pulse' };
  if (value.includes('reconnect') || value.includes('offline') || value.includes('queued')) return { text: 'Offline', dot: 'bg-[#f59e0b]' };
  if (value.includes('unavailable') || value.includes('fail')) return { text: 'Not saved', dot: 'bg-[#dc2626]' };
  if (value.startsWith('connecting')) return { text: 'Connecting…', dot: 'bg-[#94a3b8]' };
  return { text: label.replace(/\.\.\.$/, '…'), dot: 'bg-[#94a3b8]' };
}

function ToolbarSplitButton({
  icon,
  label,
  isOpen = false,
  onButtonClick,
  onArrowClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  isOpen?: boolean;
  onButtonClick?: () => void;
  onArrowClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onButtonClick}
        className={`inline-flex h-[34px] w-[30px] items-center justify-center rounded-l-[8px] text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] ${
          disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''
        }`}
      >
        {icon}
      </button>
      <button
        type="button"
        aria-label={`${label} options`}
        aria-expanded={isOpen}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onArrowClick}
        className={`inline-flex h-[34px] w-[18px] items-center justify-center rounded-r-[8px] text-[#475569] transition-colors hover:bg-[#f1f5f9] ${
          isOpen ? 'bg-[#f1f5f9]' : ''
        } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    </div>
  );
}

function ToolbarMenuButton({
  icon,
  label,
  isOpen = false,
  onClick,
  className = '',
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  isOpen?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={isOpen}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-[34px] items-center gap-0.5 rounded-[8px] px-1.5 text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] ${
        isOpen ? 'bg-[#f1f5f9] text-[#0f172a]' : ''
      } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''} ${className}`}
    >
      {icon}
      <ChevronDown className="h-3 w-3" />
    </button>
  );
}

const DROPDOWN_POSITION_RE = /\b(left-0|right-0|top-full|top-0|mt-\d+|mt-\[\S+?\])\b/g;

function stripPositionClasses(cls: string) {
  return cls.replace(DROPDOWN_POSITION_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function DropdownSurface({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const isRightAligned = className.includes('right-0');
  const sizeClasses = stripPositionClasses(className);

  const reposition = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const trigger = marker.previousElementSibling ?? marker.parentElement;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();

    let left: number;
    if (isRightAligned) {
      const panelWidth = panelRef.current?.offsetWidth ?? 260;
      left = rect.right - panelWidth;
    } else {
      left = rect.left;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - 40));

    setPos({ top: rect.bottom + 4, left });
  }, [isRightAligned]);

  useLayoutEffect(() => {
    reposition();
    // The trigger may only become visible in this commit (the second toolbar row opening).
    const frame = window.requestAnimationFrame(reposition);
    return () => window.cancelAnimationFrame(frame);
  }, [reposition]);

  useEffect(() => {
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [reposition]);

  if (typeof document === 'undefined') return null;

  return (
    <>
      <span ref={markerRef} className="hidden" aria-hidden />
      {createPortal(
        <div
          ref={panelRef}
          style={
            pos
              ? { position: 'fixed', top: pos.top, left: pos.left }
              : { position: 'fixed', top: -9999, left: -9999 }
          }
          data-docs-toolbar-dropdown=""
          className={`z-[12000] max-h-[min(72vh,600px)] overflow-y-auto rounded-[12px] border border-[#e5e7eb] bg-white p-1 text-[#0f172a] shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)] ${sizeClasses}`}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Autocomplete settings: where sources come from and which papers may be cited. */
function AutocompleteSettingsPanel({ settings, onChange }: { settings: AutocompleteSettings; onChange: (settings: AutocompleteSettings) => void }) {
  const year = new Date().getFullYear();
  const [picking, setPicking] = useState(false);
  const toggle = (label: string, hint: string, key: 'web' | 'library' | 'preprints') => (
    <button
      type="button"
      role="switch"
      aria-checked={settings[key]}
      onClick={() => onChange({ ...settings, [key]: !settings[key] })}
      className="flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-[#f8fafc]"
    >
      <span>
        <span className="block text-[13.5px] font-medium text-[#0f172a]">{label}</span>
        <span className="block text-[12px] text-[#64748b]">{hint}</span>
      </span>
      <span className={`relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors ${settings[key] ? 'bg-[var(--theme-primary)]' : 'bg-[#cbd5e1]'}`}>
        <span className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.2)] transition-all ${settings[key] ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
    </button>
  );
  const choices = <T extends number | null>(label: string, value: T, options: [T, string][], set: (value: T) => void) => (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-[13.5px] font-medium text-[#0f172a]">{label}</span>
      <div className="flex gap-1">
        {options.map(([option, text]) => (
          <button
            key={text}
            type="button"
            aria-pressed={value === option}
            onClick={() => set(option)}
            className={`h-7 rounded-[7px] px-2 text-[12.5px] ${value === option ? 'bg-[#eff6ff] font-semibold text-[#1d4ed8]' : 'text-[#475569] hover:bg-[#f1f5f9]'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const scoped = settings.libraryDocuments.length + settings.libraryFolders.length;
  return (
    <div className="max-h-[min(72vh,620px)] overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#f1f5f9] bg-white px-3.5 py-2.5 text-[14px] font-semibold text-[#0f172a]">
        <LuSettings className="h-4 w-4 text-[#64748b]" />Autocomplete settings
      </div>
      <div className="p-1.5">
        <div className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-[#94a3b8]">Sources</div>
        {toggle('Web search', 'Cite from 250M+ papers', 'web')}
        {toggle('Library search', 'Cite from your Library', 'library')}
        {settings.library ? (
          <div className="mb-1 ml-3 border-l-2 border-[#f1f5f9] pl-3 pr-1">
            <div className="text-[13px] font-medium text-[#0f172a]">Limit to</div>
            <div className="text-[12px] text-[#64748b]">{scoped ? 'Only these sources and folders' : 'Your whole Library'}</div>
            {scoped ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {settings.libraryFolders.map((folder) => (
                  <span key={folder.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#eff6ff] px-1.5 py-0.5 text-[12px] text-[#1d4ed8]">
                    <LuFolder className="h-3 w-3 shrink-0" /><span className="truncate">{folder.name}</span>
                    <button type="button" aria-label={`Remove ${folder.name}`} onClick={() => onChange({ ...settings, libraryFolders: settings.libraryFolders.filter((item) => item.id !== folder.id) })}><LuX className="h-3 w-3" /></button>
                  </span>
                ))}
                {settings.libraryDocuments.map((document) => (
                  <span key={document.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#f1f5f9] px-1.5 py-0.5 text-[12px] text-[#334155]">
                    <LuFileText className="h-3 w-3 shrink-0" /><span className="max-w-[200px] truncate">{document.title}</span>
                    <button type="button" aria-label={`Remove ${document.title}`} onClick={() => onChange({ ...settings, libraryDocuments: settings.libraryDocuments.filter((item) => item.id !== document.id) })}><LuX className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            ) : null}
            {picking ? (
              <LibraryScopePicker settings={settings} onChange={onChange} onClose={() => setPicking(false)} />
            ) : (
              <button type="button" onClick={() => setPicking(true)} className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#e2e8f0] px-2 text-[12.5px] font-medium text-[#334155] hover:bg-[#f8fafc]">
                <LuPlus className="h-3.5 w-3.5" />Select sources
              </button>
            )}
          </div>
        ) : null}
        <div className="px-2.5 pb-1 pt-3 text-[11.5px] font-medium text-[#94a3b8]">Citation filters</div>
        {choices('Published', settings.yearFrom, [[null, 'All'], [year - 5, 'Last 5 years'], [year - 10, 'Last 10']], (yearFrom) => onChange({ ...settings, yearFrom }))}
        {choices('Cited by', settings.minCited, [[null, 'All'], [5, '5+'], [20, '20+'], [50, '50+']], (minCited) => onChange({ ...settings, minCited }))}
        {toggle('Include preprints', 'Papers not yet peer reviewed', 'preprints')}
      </div>
    </div>
  );
}

/** "Select sources": pick Library sources or whole folders (collections) to cite from. */
function LibraryScopePicker({ settings, onChange, onClose }: { settings: AutocompleteSettings; onChange: (settings: AutocompleteSettings) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'sources' | 'folders'>('sources');
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<{ id: string; title: string; year?: string | number | null }[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string; count: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (tab === 'sources') {
        void getDocuments({ search: query || undefined, page_size: 20 })
          .then((response) => !cancelled && setDocuments(response.documents.map((item) => ({ id: item.id, title: item.title || item.filename, year: (item as any).year }))))
          .catch(() => !cancelled && setDocuments([]));
      } else {
        void getFolders()
          .then((list) => !cancelled && setFolders(list.map((folder) => ({ id: folder.id, name: folder.name, count: folder.document_count })).filter((folder) => folder.name.toLowerCase().includes(query.toLowerCase()))))
          .catch(() => !cancelled && setFolders([]));
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, tab]);
  const chosenDocs = new Set(settings.libraryDocuments.map((item) => item.id));
  const chosenFolders = new Set(settings.libraryFolders.map((item) => item.id));
  return (
    <div className="mt-1.5 rounded-[10px] border border-[#e5e7eb] bg-white p-1.5 shadow-[0_12px_28px_-16px_rgba(15,23,42,.35)]">
      <div className="flex items-center gap-1">
        {(['sources', 'folders'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`h-7 rounded-[7px] px-2 text-[12.5px] ${tab === value ? 'bg-[#f1f5f9] font-semibold text-[#0f172a]' : 'text-[#64748b] hover:text-[#0f172a]'}`}>
            {value === 'sources' ? 'Sources' : 'Folders'}
          </button>
        ))}
        <button type="button" onClick={onClose} aria-label="Done" title="Done" className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"><LuCheck className="h-4 w-4" /></button>
      </div>
      <label className="relative mt-1 block">
        <LuSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'sources' ? 'Search sources…' : 'Search folders…'} className="h-8 w-full rounded-[8px] border border-[#e2e8f0] pl-8 pr-2 text-[13px] outline-none focus:border-[var(--theme-primary)]" />
      </label>
      <ul className="mt-1 max-h-[220px] overflow-y-auto">
        {tab === 'sources'
          ? documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  aria-pressed={chosenDocs.has(document.id)}
                  onClick={() => onChange({
                    ...settings,
                    libraryDocuments: chosenDocs.has(document.id)
                      ? settings.libraryDocuments.filter((item) => item.id !== document.id)
                      : [...settings.libraryDocuments, { id: document.id, title: document.title }].slice(0, 50),
                  })}
                  className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${chosenDocs.has(document.id) ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white' : 'border-[#cbd5e1]'}`}>{chosenDocs.has(document.id) ? <LuCheck className="h-3 w-3" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{document.title}</span>
                </button>
              </li>
            ))
          : folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  aria-pressed={chosenFolders.has(folder.id)}
                  onClick={() => onChange({
                    ...settings,
                    libraryFolders: chosenFolders.has(folder.id)
                      ? settings.libraryFolders.filter((item) => item.id !== folder.id)
                      : [...settings.libraryFolders, { id: folder.id, name: folder.name }].slice(0, 50),
                  })}
                  className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  <LuFolder className={`h-4 w-4 shrink-0 ${chosenFolders.has(folder.id) ? 'text-[var(--theme-primary)]' : 'text-[#94a3b8]'}`} />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <span className="text-[12px] text-[#94a3b8]">{folder.count}</span>
                  {chosenFolders.has(folder.id) ? <LuCheck className="h-3.5 w-3.5 text-[var(--theme-primary)]" /> : null}
                </button>
              </li>
            ))}
        {(tab === 'sources' ? documents.length : folders.length) === 0 ? (
          <li className="px-2 py-3 text-center text-[12.5px] text-[#94a3b8]">{tab === 'sources' ? 'No sources found' : 'No folders yet'}</li>
        ) : null}
      </ul>
    </div>
  );
}

function DropdownList({
  items,
  compact = false,
  onItemSelect,
}: {
  items: MenuItem[];
  compact?: boolean;
  onItemSelect?: (item: MenuItem) => void;
}) {
  return (
    <div className="min-w-0">
      {items.map((item, index) => (
        <div key={`${item.label}-${item.shortcut ?? ''}-${index}`}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onItemSelect?.(item)}
            title={item.description}
            className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left transition-colors hover:bg-[#f1f5f9] ${
              compact ? 'min-h-[32px] py-1' : 'min-h-[34px] py-1'
            }`}
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
              {item.selected ? <LuCheck className="h-4 w-4" /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#0f172a]">{item.label}</span>
            {item.shortcut ? (
              <span className="shrink-0 pl-3 text-[12px] text-[#94a3b8]">{item.shortcut}</span>
            ) : null}
          </button>
          {item.dividerAfter ? <div className="my-1 h-px bg-[#f1f5f9]" /> : null}
        </div>
      ))}
    </div>
  );
}

export default function GoogleDocsHeader({
  documentId,
  wordSettings,
  onWordSettingsChange,
  documentComments,
  isPageView,
  onPageViewToggle,
  editor,
  documentTitle,
  onDocumentTitleChange,
  documentStatusLabel,
  collaborators,
  sharedMembers,
  isLinkSharingEnabled,
  currentUserDisplayName,
  activeRole,
  canEdit,
  onShareClick,
  onCopyLinkClick,
  onPrintClick,
  onVersionHistoryClick,
  onDocsHomeClick,
  onCreateDocumentClick,
  onDuplicateDocumentClick,
  onDeleteDocumentClick,
  onMainMenuClick,
  isNavCollapsed,
  autocompleteSettings,
  onAutocompleteSettingsChange,
  isStarred = false,
  onStarToggle,
  isOutlinePanelVisible = true,
  onOutlineToggle,
  canComment = false,
  onCommentClick,
  onShowCommentsClick,
  onOpenAssistant,
  onInsertCitation,
  onInsertInlineEquation,
  onBookmarkClick,
  editingModeValue = 'Editing',
  onEditingModeChange,
  pageWidthPx = 816,
  onPageWidthChange,
  zoomValue = '100%',
  onZoomChange,
  spellCheckEnabled = false,
  onSpellCheckToggle,
  citationStyle = 'apa',
  onCitationStyleChange,
  aiWritingSuggestionsEnabled = true,
  onToggleAIWritingSuggestions,
  aiReviewSuggestionsEnabled = true,
  onToggleAIReviewSuggestions,
  onStartWritingClick,
  isAIWritingActive = false,
  isAIWritingLoading = false,
  humanScore,
  flaggedCount = 0,
  onViewAndHumanizeClick,
  articleViewAction,
  onReviewClick,
  isAssistantOpen = false,
  onToggleAssistant,
}: GoogleDocsHeaderProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleCommitTimerRef = useRef<number | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const importDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const imageCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(documentTitle);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isPhoneSheetOpen, setIsPhoneSheetOpen] = useState(false);
  const [phoneSheetMenu, setPhoneSheetMenu] = useState<string | null>(null);
  // The toolbar shows the mockup's tools; "⋯ More tools" opens the rest as a second row.
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
  const toolbarRowRef = useRef<HTMLDivElement | null>(null);
  const toolbarToggleRef = useRef<HTMLSpanElement | null>(null);
  const [toolbarOverflows, setToolbarOverflows] = useState(false);
  // Tools that wrap past the first line are marked and hidden (CSS) until ⋮ opens them.
  useLayoutEffect(() => {
    const row = toolbarRowRef.current;
    if (!row) return undefined;
    const mark = () => {
      const children = Array.from(row.children) as HTMLElement[];
      const top = children.find((child) => child.offsetParent !== null)?.offsetTop ?? 0;
      let wrapped = false;
      for (const child of children) {
        const isWrapped = child.offsetParent !== null && child.offsetTop > top + 6;
        if (isWrapped) wrapped = true;
        child.toggleAttribute('data-wrapped', isWrapped);
      }
      setToolbarOverflows(wrapped);
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(row);
    return () => observer.disconnect();
  });
  useEffect(() => {
    if (!isToolbarExpanded) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (toolbarRowRef.current?.contains(target) || toolbarToggleRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-docs-toolbar-dropdown]')) return;
      setIsToolbarExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isToolbarExpanded]);
  // The header "⋯" menu: a group of commands (File, Edit, …) shown in place of the group list.
  const [moreMenuGroup, setMoreMenuGroup] = useState<string | null>(null);
  const editorConfig = useEditorConfig();
  const account = useEditorAccount(Boolean(editorConfig.user));
  // The title field is as wide as its text (measured with a hidden copy), so "● Saved" sits beside it.
  const titleMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [titleWidth, setTitleWidth] = useState<number | null>(null);
  const [styleValue, setStyleValue] = useState('Normal text');
  // The document's own font (Source Serif 4) until a font is chosen for the selection.
  const [fontValue, setFontValue] = useState('Source Serif 4');
  const [fontSizeValue, setFontSizeValue] = useState('12');
  const [paintFormatOn, setPaintFormatOn] = useState(false);
  const [copiedFormatting, setCopiedFormatting] = useState<Record<string, string | boolean> | null>(null);
  const [paintFormatSourceBlockId, setPaintFormatSourceBlockId] = useState<string | null>(null);
  const [textColorChoice, setTextColorChoice] = useState('#000000');
  const [highlightChoice, setHighlightChoice] = useState('transparent');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentFonts, setRecentFonts] = useState<string[]>(['Times New Roman']);
  const [fontSubmenuFamily, setFontSubmenuFamily] = useState<string | null>(null);
  const [fontCatalogQuery, setFontCatalogQuery] = useState('');
  const [isMoreFontsOpen, setIsMoreFontsOpen] = useState(false);
  const [activeStyles, setActiveStyles] = useState<Record<string, string | boolean>>({});
  const [activeTextAlignment, setActiveTextAlignment] = useState<DocsTextAlignment>('left');
  const [activeListType, setActiveListType] = useState<DocsListType | null>(null);
  const [isTableSelectionActive, setIsTableSelectionActive] = useState(false);
  const [activeTableCell, setActiveTableCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedLinkUrl, setSelectedLinkUrl] = useState<string | undefined>(undefined);
  const [linkEditorUrl, setLinkEditorUrl] = useState('https://');
  const [linkEditorText, setLinkEditorText] = useState('');
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null);
  const [isWordCountOpen, setIsWordCountOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [isGeminiDialogOpen, setIsGeminiDialogOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState('');
  const [isCitationDialogOpen, setIsCitationDialogOpen] = useState(false);
  const [citationLabel, setCitationLabel] = useState('');
  const [citationUrl, setCitationUrl] = useState('');
  const [savedCitations, setSavedCitations] = useState<CitationEntry[]>([]);
  const [isEquationDialogOpen, setIsEquationDialogOpen] = useState(false);
  const [equationValue, setEquationValue] = useState('');
  const [isPageSetupDialogOpen, setIsPageSetupDialogOpen] = useState(false);
  const [documentLanguage, setDocumentLanguage] = useState('English');
  const [isAvailableOffline, setIsAvailableOffline] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  // Escape closes the header's own dialogs (word count, details, shortcuts).
  useEffect(() => {
    if (!isWordCountOpen && !isDetailsDialogOpen && !isKeyboardShortcutsOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsWordCountOpen(false);
      setIsDetailsDialogOpen(false);
      setIsKeyboardShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isWordCountOpen, isDetailsDialogOpen, isKeyboardShortcutsOpen]);
  const [listVariants, setListVariants] = useState<StoredListVariants>({
    bullet: {},
    numbered: {},
    checklist: {},
  });
  const writeWithAiLabel = isAIWritingLoading ? 'Writing...' : 'Write with AI';
  const writeWithAiIcon = isAIWritingLoading ? (
    <LuRefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
  ) : (
    <LuSparkles className="h-3.5 w-3.5" aria-hidden="true" />
  );

  useEffect(() => {
    if (!isTitleFocused) {
      setTitleDraft(documentTitle);
    }
  }, [documentTitle, isTitleFocused]);

  useLayoutEffect(() => {
    const width = titleMeasureRef.current?.offsetWidth;
    if (width) setTitleWidth(width);
  }, [titleDraft]);
  // Measured again once the web font is in: the fallback font is narrower and cut the title short.
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      const width = titleMeasureRef.current?.offsetWidth;
      if (!cancelled && width) setTitleWidth(width);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (titleCommitTimerRef.current) {
        window.clearTimeout(titleCommitTimerRef.current);
      }
    };
  }, []);

  const flushTitleChange = useCallback(
    (value: string) => {
      if (titleCommitTimerRef.current) {
        window.clearTimeout(titleCommitTimerRef.current);
        titleCommitTimerRef.current = null;
      }
      onDocumentTitleChange(value);
    },
    [onDocumentTitleChange],
  );

  const scheduleTitleChange = useCallback(
    (value: string) => {
      if (titleCommitTimerRef.current) {
        window.clearTimeout(titleCommitTimerRef.current);
      }
      titleCommitTimerRef.current = window.setTimeout(() => {
        onDocumentTitleChange(value);
        titleCommitTimerRef.current = null;
      }, 250);
    },
    [onDocumentTitleChange],
  );

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') {
      setDocumentLanguage('English');
      setIsAvailableOffline(false);
      return;
    }

    setDocumentLanguage(window.localStorage.getItem(`ai-editor-language:${documentId}`) ?? 'English');
    setIsAvailableOffline(window.localStorage.getItem(`ai-editor-offline:${documentId}`) === 'true');
    try {
      const rawCitations = window.localStorage.getItem(`ai-editor-citations:${documentId}`);
      const parsed = rawCitations ? JSON.parse(rawCitations) : [];
      setSavedCitations(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedCitations([]);
    }

    try {
      const rawListVariants = window.localStorage.getItem(`ai-editor-list-variants:${documentId}`);
      const parsed = rawListVariants ? JSON.parse(rawListVariants) : {};
      setListVariants({
        bullet: parsed?.bullet ?? {},
        numbered: parsed?.numbered ?? {},
        checklist: parsed?.checklist ?? {},
      });
    } catch {
      setListVariants({ bullet: {}, numbered: {}, checklist: {} });
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') {
      return;
    }

    const handleCitationStorageUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ documentId?: string; citations?: CitationEntry[] }>;
      if (customEvent.detail?.documentId !== documentId) {
        return;
      }

      setSavedCitations(Array.isArray(customEvent.detail?.citations) ? customEvent.detail.citations : []);
    };

    window.addEventListener('ai-editor-citations-updated', handleCitationStorageUpdate as EventListener);
    return () => {
      window.removeEventListener('ai-editor-citations-updated', handleCitationStorageUpdate as EventListener);
    };
  }, [documentId]);

  const filteredFontCatalog = useMemo(() => {
    const q = fontCatalogQuery.trim().toLowerCase();
    if (!q) {
      return DOCS_FONT_CATALOG;
    }

    return DOCS_FONT_CATALOG.filter((item) => item.family.toLowerCase().includes(q));
  }, [fontCatalogQuery]);

  const wordCountStats = (() => {
    if (!editor) {
      return {
        words: 0,
        characters: 0,
        charactersNoSpaces: 0,
        paragraphs: 0,
      };
    }

    const parts: string[] = [];
    let paragraphs = 0;

    editor.forEachBlock((block) => {
      const text = getPlainTextFromBlockContent(block.content).trim();
      if (text) {
        parts.push(text);
      }
      if (block.type === 'paragraph') {
        paragraphs += 1;
      }
      return true;
    });

    const plainText = parts.join('\n');
    const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
    const characters = plainText.length;
    const charactersNoSpaces = plainText.replace(/\s+/g, '').length;

    return {
      words,
      characters,
      charactersNoSpaces,
      paragraphs,
    };
  })();

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (headerRef.current?.contains(target)) {
        return;
      }

      const dropdownPanel = (target as HTMLElement).closest?.('[data-docs-toolbar-dropdown]');
      if (dropdownPanel) {
        return;
      }

      setOpenDropdown(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (openDropdown !== 'select-font') {
      setFontSubmenuFamily(null);
    }
  }, [openDropdown]);

  // Pop-ups that hang off the second toolbar row open it first (menu commands open them too).
  useLayoutEffect(() => {
    if (openDropdown && SECOND_ROW_DROPDOWNS.has(openDropdown) && toolbarRowRef.current?.querySelector('[data-wrapped]')) setIsToolbarExpanded(true);
  }, [openDropdown]);

  const toggleDropdown = (id: string) => {
    setOpenDropdown((current) => (current === id ? null : id));
  };

  const closeDropdown = useCallback(() => {
    setOpenDropdown(null);
  }, []);

  const handleSearchMenuSelection = useCallback(
    (item: MenuItem) => {
      if (topMenus.includes(item.label)) {
        setOpenDropdown(`menu-${item.label}`);
        return;
      }

      closeDropdown();
    },
    [],
  );

  const syncToolbarFromEditor = useCallback(() => {
    if (!editor) {
      return;
    }

    const block = getPrimarySelectedBlock(editor);
    const styles = editor.getActiveStyles() as Record<string, string | boolean>;

    setActiveStyles((previous) => (shallowEqualRecord(previous, styles) ? previous : styles));
    setCurrentBlockId(block?.id ?? null);
    setStyleValue(getStyleLabelFromBlock(block));
    setFontValue(getFontFamilyLabel(typeof styles.fontFamily === 'string' ? styles.fontFamily : undefined) ?? 'Source Serif 4');
    setFontSizeValue(getFontSizeLabel(typeof styles.fontSize === 'string' ? styles.fontSize : undefined) ?? '12');
    setTextColorChoice(getToolbarTextColor(typeof styles.textColor === 'string' ? styles.textColor : undefined));
    setHighlightChoice(
      getToolbarHighlightColor(
        typeof styles.backgroundColor === 'string' ? styles.backgroundColor : undefined,
      ),
    );
    setActiveTextAlignment(
      block?.props.textAlignment === 'center' ||
        block?.props.textAlignment === 'right' ||
        block?.props.textAlignment === 'justify'
        ? block.props.textAlignment
        : 'left',
    );
    setActiveListType(
      block?.type === 'bulletListItem' ||
        block?.type === 'numberedListItem' ||
        block?.type === 'checkListItem'
        ? block.type
        : null,
    );
    const tableContext = getSelectedTableContext(editor);
    setIsTableSelectionActive(Boolean(tableContext.block && tableContext.anchor));
    const anchor = tableContext.anchor;
    setActiveTableCell((previous) =>
      anchor
        ? previous && previous.row === anchor.row && previous.col === anchor.col
          ? previous
          : { row: anchor.row, col: anchor.col }
        : null,
    );
    setSelectedLinkUrl(editor.getSelectedLinkUrl());
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    syncToolbarFromEditor();
    const unsubscribeSelection = editor.onSelectionChange(() => {
      syncToolbarFromEditor();
    });
    const unsubscribeChange = editor.onChange(() => {
      syncToolbarFromEditor();
    }, true);

    return () => {
      unsubscribeSelection?.();
      unsubscribeChange?.();
    };
  }, [editor, syncToolbarFromEditor]);

  const runEditorAction = useCallback(
    (action: (currentEditor: DocsEditor) => void, requiresEdit = true) => {
      if (!editor || (requiresEdit && !canEdit)) {
        return;
      }

      try {
        editor.focus();
        action(editor);
      } catch (error) {
        console.error('AI editor toolbar action failed:', error);
      }

      window.setTimeout(() => {
        editor.focus();
        syncToolbarFromEditor();
      }, 0);
    },
    [canEdit, editor, syncToolbarFromEditor],
  );

  useEffect(() => {
    if (!paintFormatOn || !copiedFormatting || !currentBlockId || currentBlockId === paintFormatSourceBlockId) {
      return;
    }

    runEditorAction((currentEditor) => {
      currentEditor.addStyles(copiedFormatting as any);
    });
    setPaintFormatOn(false);
    setCopiedFormatting(null);
    setPaintFormatSourceBlockId(null);
  }, [copiedFormatting, currentBlockId, paintFormatOn, paintFormatSourceBlockId, runEditorAction]);

  const updateSelectedBlocks = useCallback(
    (updater: (block: DocsBlock) => Record<string, unknown> | null) => {
      runEditorAction((currentEditor) => {
        getTargetBlocks(currentEditor).forEach((block) => {
          const update = updater(block);
          if (update) {
            currentEditor.updateBlock(block.id, update as any);
          }
        });
      });
    },
    [runEditorAction],
  );

  const handleStyleSelection = useCallback(
    (option: string) => {
      setStyleValue(option);
      closeDropdown();

      const levelMap: Record<string, number> = {
        Title: 1,
        Subtitle: 2,
        'Heading 1': 1,
        'Heading 2': 2,
        'Heading 3': 3,
        'Heading 4': 4,
        'Heading 5': 5,
        'Heading 6': 6,
        'TOC heading': 2,
      };

      if (option === 'Normal text') {
        updateSelectedBlocks(() => ({ type: 'paragraph' }));
        return;
      }

      const headingLevel = levelMap[option];
      if (headingLevel) {
        updateSelectedBlocks(() => ({
          type: 'heading',
          props: { level: headingLevel },
        }));
      }
    },
    [updateSelectedBlocks],
  );

  const selectFontFamily = (family: string, variant?: string) => {
    setFontValue(family);
    setRecentFonts((prev) => [family, ...prev.filter((f) => f !== family)].slice(0, 5));
    runEditorAction((currentEditor) => {
      currentEditor.addStyles(
        {
          fontFamily: family,
          fontWeight: getFontWeightValue(variant),
        } as any,
      );
    });
    closeDropdown();
    setIsMoreFontsOpen(false);
  };

  const applyFontSizeValue = useCallback(
    (nextValue: string) => {
      setFontSizeValue(nextValue);
      runEditorAction((currentEditor) => {
        currentEditor.addStyles({ fontSize: normalizeFontSizeValue(nextValue) } as any);
      });
    },
    [runEditorAction],
  );

  const handleToggleInlineStyle = useCallback(
    (style: 'bold' | 'italic' | 'underline' | 'strike') => {
      runEditorAction((currentEditor) => {
        currentEditor.toggleStyles({ [style]: true } as any);
      });
    },
    [runEditorAction],
  );

  const handleTextColorChange = useCallback(
    (hex: string) => {
      setTextColorChoice(getToolbarTextColor(hex));
      runEditorAction((currentEditor) => {
        if (hex === 'default') {
          currentEditor.removeStyles({ textColor: 'default' } as any);
          return;
        }

        currentEditor.addStyles({ textColor: hex } as any);
      });
      closeDropdown();
    },
    [runEditorAction],
  );

  const handleHighlightChange = useCallback(
    (hex: string) => {
      setHighlightChoice(getToolbarHighlightColor(hex));
      runEditorAction((currentEditor) => {
        if (hex === 'default') {
          currentEditor.removeStyles({ backgroundColor: 'default' } as any);
          return;
        }

        currentEditor.addStyles({ backgroundColor: hex } as any);
      });
      closeDropdown();
    },
    [runEditorAction],
  );

  const handleOpenLinkEditor = useCallback(() => {
    if (!editor || !canEdit) {
      return;
    }

    const currentUrl = editor.getSelectedLinkUrl() ?? '';
    const selectedText = editor.getSelectedText().trim();
    setLinkEditorUrl(currentUrl || 'https://');
    setLinkEditorText(selectedText);
    setOpenDropdown('toolbar-link-editor');
  }, [canEdit, editor]);

  const handleSubmitLinkEditor = useCallback(() => {
    const trimmedUrl = linkEditorUrl.trim();
    if (!trimmedUrl) {
      return;
    }

    const normalizedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl)
      ? trimmedUrl
      : `https://${trimmedUrl.replace(/^\/+/, '')}`;
    const displayText = linkEditorText.trim() || editor?.getSelectedText().trim() || normalizedUrl;

    runEditorAction((currentEditor) => {
      currentEditor.createLink(normalizedUrl, displayText);
    });
    closeDropdown();
  }, [editor, linkEditorText, linkEditorUrl, runEditorAction]);

  const handleRemoveSelectedLink = useCallback(() => {
    runEditorAction((currentEditor) => {
      const tiptapEditor = (currentEditor as any)._tiptapEditor;
      tiptapEditor?.chain().focus().extendMarkRange('link').unsetLink().run();
    });
    closeDropdown();
  }, [runEditorAction]);

  const handleSelectAll = useCallback(() => {
    runEditorAction(
      (currentEditor) => {
        const tiptapEditor = (currentEditor as any)._tiptapEditor;
        tiptapEditor?.chain().focus().selectAll().run();
      },
      false,
    );
  }, [runEditorAction]);

  // Edit › Copy / Cut use the editor's own clipboard handling (formatting, citations and
  // equations survive a paste into Word or Docs); plain text is the fallback.
  const copyOrCut = useCallback(async (command: 'copy' | 'cut') => {
    const selectedText = editor?.getSelectedText() ?? '';
    if (!selectedText.trim()) {
      toast('Select some text first.');
      return;
    }
    const view = (editor as any)?._tiptapEditor?.view;
    view?.focus();
    if (document.execCommand(command)) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      if (command === 'cut') {
        runEditorAction((currentEditor) => {
          (currentEditor as any)._tiptapEditor?.chain().focus().deleteSelection().run();
        });
      }
    } catch {
      toast(`Your browser blocked the clipboard. Press ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+${command === 'copy' ? 'C' : 'X'} instead.`);
    }
  }, [editor, runEditorAction]);
  const handleCopySelection = useCallback(() => copyOrCut('copy'), [copyOrCut]);
  const handleCutSelection = useCallback(() => copyOrCut('cut'), [copyOrCut]);

  // Edit › Paste keeps formatting when the clipboard has it; "Paste without formatting" is text only.
  const handlePaste = useCallback(async (plain: boolean) => {
    try {
      if (!plain && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        const htmlItem = items.find((item) => item.types.includes('text/html'));
        if (htmlItem) {
          const html = await (await htmlItem.getType('text/html')).text();
          runEditorAction((currentEditor) => currentEditor.pasteHTML(html));
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast('The clipboard has no text to paste.');
        return;
      }
      runEditorAction((currentEditor) => {
        const tiptapEditor = (currentEditor as any)._tiptapEditor;
        tiptapEditor?.chain().focus().insertContent(text).run();
      });
    } catch (error) {
      // Browsers only let a page read the clipboard with permission; the keyboard always works.
      console.warn('Clipboard read was refused:', error);
      toast(`Your browser blocked reading the clipboard. Press ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+${plain ? 'Shift+V' : 'V'} to paste.`);
    }
  }, [runEditorAction]);

  // Find / Find and replace open the in-document bar (highlights, n of m, replace all).
  const [findBar, setFindBar] = useState<{ replace: boolean; query: string; key: number } | null>(null);
  const handleFindInDocument = useCallback(() => {
    setFindBar({ replace: false, query: editor?.getSelectedText().trim() ?? '', key: Date.now() });
  }, [editor]);

  const handleFindAndReplace = useCallback(() => {
    setFindBar({ replace: true, query: editor?.getSelectedText().trim() ?? '', key: Date.now() });
  }, [editor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'f' && key !== 'h') return;
      // Only for the document page (not when typing in another field).
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName) && !target.closest('.ce-find-bar')) return;
      if (!document.querySelector('.ai-editor-blocknote')) return;
      event.preventDefault();
      if (key === 'f' && !event.shiftKey) handleFindInDocument();
      if (key === 'h') handleFindAndReplace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleFindAndReplace, handleFindInDocument]);


  const handlePageWidthSelection = useCallback(
    (nextWidth: number) => {
      onPageWidthChange?.(nextWidth);
      if (documentId && typeof window !== 'undefined') {
        window.localStorage.setItem(`ai-editor-page-width:${documentId}`, String(nextWidth));
      }
      setIsPageSetupDialogOpen(false);
    },
    [documentId, onPageWidthChange],
  );

  const handleLanguageSelection = useCallback(
    (language: string) => {
      setDocumentLanguage(language);
      if (documentId && typeof window !== 'undefined') {
        window.localStorage.setItem(`ai-editor-language:${documentId}`, language);
      }
      closeDropdown();
    },
    [documentId],
  );

  const handleOfflineToggle = useCallback(() => {
    setIsAvailableOffline((current) => {
      const nextValue = !current;
      if (documentId && typeof window !== 'undefined') {
        window.localStorage.setItem(`ai-editor-offline:${documentId}`, String(nextValue));
      }
      return nextValue;
    });
  }, [documentId]);

  const handleDownloadDocument = useCallback(() => {
    if (!editor || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const text = editor.document
      .map((block) => getPlainTextFromBlockContent(block.content))
      .filter(Boolean)
      .join('\n\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, createExportFilename(documentTitle, 'txt'));
  }, [documentTitle, editor]);

  const generateDocxBlob = useCallback(async (): Promise<Blob | null> => {
    if (!editor || typeof window === 'undefined') {
      return null;
    }

    try {
      const {
        AlignmentType,
        BorderStyle,
        Document,
        ExternalHyperlink,
        HeadingLevel,
        HighlightColor,
        ImageRun,
        LevelFormat,
        LevelSuffix,
        Math: OfficeMath,
        MathFraction,
        MathRadical,
        MathRun,
        MathSubScript,
        MathSubSuperScript,
        MathSuperScript,
        Packer,
        PageBreak,
        Paragraph,
        ShadingType,
        Table,
        TableCell,
        TableLayoutType,
        TableRow,
        TextRun,
        UnderlineType,
        WidthType,
      } = await import('docx');

      const subtleTableBorders = {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'DADCE0' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DADCE0' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'DADCE0' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'DADCE0' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E8EAED' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E8EAED' },
      };

      const normalizeDocxColor = (value: unknown) => {
        if (typeof value !== 'string') {
          return undefined;
        }

        const normalized = value.trim().replace(/^#/, '');
        if (!normalized || normalized === 'default') {
          return undefined;
        }

        if (/^[0-9a-f]{3}$/i.test(normalized)) {
          return normalized
            .split('')
            .map((part) => `${part}${part}`)
            .join('')
            .toUpperCase();
        }

        if (/^[0-9a-f]{6}$/i.test(normalized)) {
          return normalized.toUpperCase();
        }

        const keywordMap: Record<string, string> = {
          black: '000000',
          white: 'FFFFFF',
          red: 'EA4335',
          blue: '1A73E8',
          green: '188038',
          yellow: 'FBBC04',
          orange: 'E37400',
          purple: '7C4DFF',
          pink: 'D81B60',
          gray: '5F6368',
          grey: '5F6368',
          cyan: '00ACC1',
        };

        return keywordMap[normalized.toLowerCase()];
      };

      const mapHighlightColor = (value: unknown): any => {
        const normalized = normalizeDocxColor(value);
        if (!normalized) {
          return undefined;
        }

        const highlightMap: Record<string, string> = {
          FFFF00: HighlightColor.YELLOW,
          FBBC04: HighlightColor.YELLOW,
          '00FF00': HighlightColor.GREEN,
          '34A853': HighlightColor.GREEN,
          '0000FF': HighlightColor.BLUE,
          '1A73E8': HighlightColor.BLUE,
          FF0000: HighlightColor.RED,
          EA4335: HighlightColor.RED,
          FF00FF: HighlightColor.MAGENTA,
          D81B60: HighlightColor.MAGENTA,
          '00FFFF': HighlightColor.CYAN,
          '00ACC1': HighlightColor.CYAN,
          '000000': HighlightColor.BLACK,
          FFFFFF: HighlightColor.WHITE,
        };

        return highlightMap[normalized];
      };

      const alignmentFromValue = (value: unknown): any => {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (normalized === 'center') return AlignmentType.CENTER;
        if (normalized === 'right') return AlignmentType.RIGHT;
        if (normalized === 'justify') return AlignmentType.JUSTIFIED;
        return AlignmentType.LEFT;
      };

      const fontSizeToHalfPoints = (value: unknown) => {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return undefined;
        const match = raw.match(/([\d.]+)/);
        if (!match) return undefined;
        const size = Number(match[1]);
        if (!Number.isFinite(size)) return undefined;
        if (raw.endsWith('px')) {
          return Math.max(16, Math.round(size * 2));
        }
        if (raw.endsWith('pt')) {
          return Math.max(16, Math.round(size * 2));
        }
        return Math.max(16, Math.round(size * 2));
      };

      const lineHeightToTwips = (value: unknown) => {
        if (typeof value !== 'string') {
          return undefined;
        }

        const normalized = value.trim();
        if (!normalized) {
          return undefined;
        }

        if (normalized.endsWith('px')) {
          const numeric = Number.parseFloat(normalized);
          return Number.isFinite(numeric) ? Math.round(numeric * 15) : undefined;
        }

        if (normalized.endsWith('pt')) {
          const numeric = Number.parseFloat(normalized);
          return Number.isFinite(numeric) ? Math.round(numeric * 20) : undefined;
        }

        const multiplier = Number.parseFloat(normalized);
        return Number.isFinite(multiplier) ? Math.round(multiplier * 240) : undefined;
      };

      const rasterizeSvgToPng = async (svgSource: Blob | string): Promise<{ data: ArrayBuffer; width: number; height: number }> => {
        const svgText = typeof svgSource === 'string' ? svgSource : await svgSource.text();
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        const img = new window.Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('SVG load failed'));
          img.src = dataUrl;
        });
        const w = img.naturalWidth || 800;
        const h = img.naturalHeight || 600;
        const s = 2;
        const cvs = document.createElement('canvas');
        cvs.width = w * s;
        cvs.height = h * s;
        const ctx = cvs.getContext('2d')!;
        ctx.scale(s, s);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const pngBlob = await new Promise<Blob>((resolve) => cvs.toBlob((b) => resolve(b!), 'image/png'));
        return { data: await pngBlob.arrayBuffer(), width: w, height: h };
      };

      const loadImageAsset = async (src: string) => {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`Failed to load image asset: ${src}`);
        }

        const blob = await response.blob();
        const mimeType = blob.type.toLowerCase();

        if (mimeType.includes('svg')) {
          const png = await rasterizeSvgToPng(blob);
          return { ...png, imageType: 'png' as const };
        }

        const imageType = (() => {
          if (mimeType.includes('png')) return 'png' as const;
          if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg' as const;
          if (mimeType.includes('gif')) return 'gif' as const;
          if (mimeType.includes('bmp')) return 'bmp' as const;
          return null;
        })();

        const objectUrl = URL.createObjectURL(blob);
        const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
          const image = new window.Image();
          image.onload = () => {
            resolve({
              width: image.naturalWidth || 1200,
              height: image.naturalHeight || 800,
            });
            URL.revokeObjectURL(objectUrl);
          };
          image.onerror = () => {
            resolve({ width: 1200, height: 800 });
            URL.revokeObjectURL(objectUrl);
          };
          image.src = objectUrl;
        });

        return {
          data: await blob.arrayBuffer(),
          imageType,
          ...dimensions,
        };
      };

      const getScaledImageSize = (width: number, height: number, maxWidth: number) => {
        if (!width || !height) return { width: maxWidth, height: Math.round(maxWidth * 0.66) };
        if (width <= maxWidth) return { width, height };
        const ratio = maxWidth / width;
        return {
          width: Math.round(width * ratio),
          height: Math.round(height * ratio),
        };
      };

      const _greekMap: Record<string, string> = {
        alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',varepsilon:'ε',
        zeta:'ζ',eta:'η',theta:'θ',vartheta:'ϑ',iota:'ι',kappa:'κ',
        lambda:'λ',mu:'μ',nu:'ν',xi:'ξ',pi:'π',varpi:'ϖ',
        rho:'ρ',varrho:'ϱ',sigma:'σ',varsigma:'ς',tau:'τ',
        upsilon:'υ',phi:'φ',varphi:'φ',chi:'χ',psi:'ψ',omega:'ω',
        Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Xi:'Ξ',Pi:'Π',
        Sigma:'Σ',Upsilon:'Υ',Phi:'Φ',Psi:'Ψ',Omega:'Ω',
      };
      const _symMap: Record<string, string> = {
        times:'×',cdot:'·',div:'÷',pm:'±',mp:'∓',ast:'∗',star:'⋆',circ:'∘',bullet:'∙',
        leq:'≤',le:'≤',geq:'≥',ge:'≥',neq:'≠',ne:'≠',
        approx:'≈',equiv:'≡',sim:'∼',simeq:'≃',propto:'∝',
        infty:'∞',partial:'∂',nabla:'∇',prime:'′',
        sum:'∑',prod:'∏',int:'∫',oint:'∮',
        forall:'∀',exists:'∃',in:'∈',notin:'∉',ni:'∋',
        subset:'⊂',supset:'⊃',subseteq:'⊆',supseteq:'⊇',
        cup:'∪',cap:'∩',setminus:'∖',emptyset:'∅',varnothing:'∅',
        ldots:'…',cdots:'⋯',vdots:'⋮',ddots:'⋱',dots:'…',
        to:'→',rightarrow:'→',leftarrow:'←',Rightarrow:'⇒',Leftarrow:'⇐',
        leftrightarrow:'↔',Leftrightarrow:'⇔',mapsto:'↦',
        quad:'  ',qquad:'    ',',':', ',';':' ',':':' ','!':'',
        langle:'⟨',rangle:'⟩',lceil:'⌈',rceil:'⌉',lfloor:'⌊',rfloor:'⌋',
      };

      const parseLatexToMath = (latex: string): any[] => {
        type Tok = { t: string; v: string };
        const toks: Tok[] = [];
        let i = 0;
        const s = latex.trim();
        while (i < s.length) {
          const c = s[i];
          if (/\s/.test(c)) { i++; continue; }
          if (c === '\\') {
            i++;
            let cmd = '';
            while (i < s.length && /[a-zA-Z]/.test(s[i])) { cmd += s[i]; i++; }
            if (cmd) toks.push({ t: 'cmd', v: cmd });
            else if (i < s.length) { toks.push({ t: 'ch', v: s[i] }); i++; }
            continue;
          }
          if (c === '{') { toks.push({ t: '{', v: c }); i++; continue; }
          if (c === '}') { toks.push({ t: '}', v: c }); i++; continue; }
          if (c === '^') { toks.push({ t: '^', v: c }); i++; continue; }
          if (c === '_') { toks.push({ t: '_', v: c }); i++; continue; }
          toks.push({ t: 'ch', v: c }); i++;
        }

        let p = 0;
        const pk = (): Tok | null => (p < toks.length ? toks[p] : null);
        const nx = (): Tok | null => (p < toks.length ? toks[p++] : null);

        const parseGrp = (): any[] => {
          const o: any[] = [];
          while (p < toks.length && pk()?.t !== '}') o.push(...parseExpr());
          return o;
        };
        const parseArg = (): any[] => {
          if (pk()?.t === '{') { nx(); const r = parseGrp(); if (pk()?.t === '}') nx(); return r; }
          return parseExpr();
        };
        const maybeSc = (base: any[]): any[] => {
          let sup: any[] | null = null, sub: any[] | null = null;
          while (pk()?.t === '^' || pk()?.t === '_') {
            if (pk()!.t === '^') { nx(); sup = parseArg(); }
            else { nx(); sub = parseArg(); }
          }
          if (sup && sub) return [new MathSubSuperScript({ children: base, superScript: sup, subScript: sub })];
          if (sup) return [new MathSuperScript({ children: base, superScript: sup })];
          if (sub) return [new MathSubScript({ children: base, subScript: sub })];
          return base;
        };

        const parseExpr = (): any[] => {
          const t = pk();
          if (!t) return [];

          if (t.t === '{') { nx(); const r = parseGrp(); if (pk()?.t === '}') nx(); return maybeSc(r); }

          if (t.t === 'cmd') {
            nx();
            const c = t.v;
            if (_greekMap[c]) return maybeSc([new MathRun(_greekMap[c])]);
            if (_symMap[c]) return [new MathRun(_symMap[c])];
            if (c === 'frac') { const n = parseArg(), d = parseArg(); return maybeSc([new MathFraction({ numerator: n, denominator: d })]); }
            if (c === 'sqrt') { const content = parseArg(); return [new MathRadical({ children: content })]; }
            if (c === 'left') {
              const delim = nx();
              const inner: any[] = [];
              while (p < toks.length) {
                if (pk()?.t === 'cmd' && pk()?.v === 'right') { nx(); nx(); break; }
                inner.push(...parseExpr());
              }
              return [new MathRun(delim?.v === '(' || delim?.v === '.' ? '(' : delim?.v || '('), ...inner, new MathRun(')')];
            }
            if (c === 'right') { nx(); return []; }
            if (c === 'text' || c === 'mathrm' || c === 'textrm' || c === 'textit' || c === 'operatorname') return parseArg();
            if (c === 'overline' || c === 'bar' || c === 'hat' || c === 'tilde' || c === 'vec' || c === 'dot' || c === 'mathbf' || c === 'mathit' || c === 'boldsymbol') return parseArg();
            return maybeSc([new MathRun(c)]);
          }

          if (t.t === 'ch') { nx(); return maybeSc([new MathRun(t.v)]); }

          nx();
          return [new MathRun(t.v)];
        };

        const result: any[] = [];
        while (p < toks.length) result.push(...parseExpr());
        return result;
      };

      const getInlineItems = (value: unknown): any[] => {
        if (Array.isArray(value)) {
          return value;
        }
        if (typeof value === 'string' && value) {
          return [{ type: 'text', text: value, styles: {} }];
        }
        return [];
      };

      const extractLineHeight = (items: any[]): number | undefined => {
        for (const item of items) {
          if (item?.type === 'text' && item.styles?.lineHeight) {
            const lineHeight = lineHeightToTwips(item.styles.lineHeight);
            if (lineHeight) {
              return lineHeight;
            }
          }
          if (item?.type === 'link' && Array.isArray(item.content)) {
            const nested = extractLineHeight(item.content);
            if (nested) {
              return nested;
            }
          }
        }
        return undefined;
      };

      const getRunsFromInlineItems = (items: any[]): any[] => {
        const result: any[] = [];

        for (const item of items) {
          if (!item) {
            continue;
          }

          if (typeof item === 'string') {
            if (item) {
              result.push(new TextRun({ text: item }));
            }
            continue;
          }

          if (item.type === 'text') {
            const styles = item.styles ?? {};
            const fontWeight = Number.parseInt(String(styles.fontWeight ?? ''), 10);
            const backgroundColor = normalizeDocxColor(styles.backgroundColor);
            result.push(
              new TextRun({
                text: item.text ?? '',
                bold: Boolean(styles.bold) || (Number.isFinite(fontWeight) && fontWeight >= 600),
                italics: Boolean(styles.italic),
                underline: styles.underline ? { type: UnderlineType.SINGLE } : undefined,
                strike: Boolean(styles.strike),
                color: normalizeDocxColor(styles.textColor),
                font: typeof styles.fontFamily === 'string' ? styles.fontFamily : undefined,
                size: fontSizeToHalfPoints(styles.fontSize),
                highlight: mapHighlightColor(styles.backgroundColor),
                shading: backgroundColor
                  ? {
                      fill: backgroundColor,
                      type: ShadingType.CLEAR,
                    }
                  : undefined,
                subScript: Boolean(styles.subscript),
                superScript: Boolean(styles.superscript),
              }),
            );
            continue;
          }

          if (item.type === 'link') {
            const linkChildren = getRunsFromInlineItems(getInlineItems(item.content));
            result.push(
              new ExternalHyperlink({
                link: typeof item.href === 'string' ? item.href : '',
                children:
                  linkChildren.length > 0
                    ? linkChildren
                    : [new TextRun({ text: normalizeTextContent(item.href) || '' })],
              }),
            );
            continue;
          }

          if (item.type === 'aiMention') {
            const label = item.props?.displayName || item.props?.email || 'Mention';
            const color = normalizeDocxColor(item.props?.color) ?? '1A73E8';
            result.push(
              new TextRun({
                text: `@${label}`,
                bold: true,
                color,
                shading: {
                  fill: color,
                  color: 'FFFFFF',
                  type: ShadingType.PERCENT_10,
                },
              }),
            );
            continue;
          }

          if (item.type === 'aiCitation') {
            result.push(
              new TextRun({
                text: normalizeTextContent(item.props?.displayText) || '(Citation)',
                color: '174EA6',
                underline: { type: UnderlineType.SINGLE },
              }),
            );
            continue;
          }

          if (item.type === 'aiMath') {
            const latex = item.props?.latex || '';
            try {
              const mc = parseLatexToMath(latex);
              if (mc.length) { result.push(new OfficeMath({ children: mc })); }
              else { result.push(new TextRun({ text: latex, italics: true, font: 'Cambria Math' })); }
            } catch {
              result.push(new TextRun({ text: latex, italics: true, font: 'Cambria Math' }));
            }
            continue;
          }

        }

        return result;
      };

      const createParagraphForBlock = (block: any, runs: any[], listDepth = 0) => {
        const contentItems = getInlineItems(block?.content);
        const lineHeight = extractLineHeight(contentItems);
        const backgroundColor = normalizeDocxColor(block?.props?.backgroundColor);
        const paragraphOptions: Record<string, any> = {
          alignment: alignmentFromValue(block?.props?.textAlignment),
          spacing: {
            before: block?.type === 'heading' ? 240 : 0,
            after: block?.type === 'heading' ? 120 : block?.type?.includes('ListItem') ? 60 : 140,
            line: lineHeight,
          },
          shading: backgroundColor
            ? {
                fill: backgroundColor,
                type: ShadingType.CLEAR,
              }
            : undefined,
          children: runs.length > 0 ? runs : [new TextRun({ text: ' ' })],
        };

        if (block?.type === 'heading') {
          const level = Number(block?.props?.level ?? 1);
          paragraphOptions.heading =
            ({
              1: HeadingLevel.HEADING_1,
              2: HeadingLevel.HEADING_2,
              3: HeadingLevel.HEADING_3,
              4: HeadingLevel.HEADING_4,
              5: HeadingLevel.HEADING_5,
              6: HeadingLevel.HEADING_6,
            } as Record<number, any>)[level] ?? HeadingLevel.HEADING_1;
        }

        if (block?.type === 'bulletListItem') {
          paragraphOptions.numbering = {
            reference: 'ai-editor-bullets',
            level: Math.min(listDepth, 8),
          };
        }

        if (block?.type === 'numberedListItem') {
          paragraphOptions.numbering = {
            reference: 'ai-editor-numbered',
            level: Math.min(listDepth, 8),
          };
        }

        if (block?.type === 'checkListItem') {
          paragraphOptions.indent = {
            left: 720 + Math.min(listDepth, 8) * 360,
            hanging: 240,
          };
          paragraphOptions.children = [
            new TextRun({
              text: block?.props?.checked ? '☑ ' : '☐ ',
              bold: true,
            }),
            ...(runs.length > 0 ? runs : [new TextRun({ text: ' ' })]),
          ];
        }

        return new Paragraph(paragraphOptions);
      };

      const convertTableCellContent = (content: unknown, cellProps?: Record<string, unknown>) => {
        const runs = getRunsFromInlineItems(getInlineItems(content));
        const fallbackColor = normalizeDocxColor(cellProps?.textColor);

        return [
          new Paragraph({
            alignment: alignmentFromValue(cellProps?.textAlignment),
            children:
              runs.length > 0
                ? runs
                : [
                    new TextRun({
                      text: ' ',
                      color: fallbackColor,
                    }),
                  ],
          }),
        ];
      };

      const convertBlocksToDocxChildren = async (blocks: any[], listDepth = 0): Promise<any[]> => {
        const children: any[] = [];

        for (const block of blocks) {
          if (!block) {
            continue;
          }

          if (block.type === 'pageBreak') {
            children.push(new Paragraph({ children: [new PageBreak()] }));
          } else if (block.type === 'divider') {
            children.push(
              new Paragraph({
                thematicBreak: true,
                spacing: { before: 120, after: 120 },
              }),
            );
          } else if (block.type === 'table') {
            const rows = Array.isArray(block.content?.rows) ? block.content.rows : [];
            const headerRows = Number(block.content?.headerRows ?? 0);
            const columnWidths = Array.isArray(block.content?.columnWidths) ? block.content.columnWidths : [];
            const totalColumnWidth = columnWidths.reduce(
              (sum: number, width: unknown) => sum + (Number(width) > 0 ? Number(width) : 0),
              0,
            );

            children.push(
              new Table({
                rows: rows.map((row: any, rowIndex: number) => {
                  const rowCells = Array.isArray(row?.cells) ? row.cells : [];
                  return new TableRow({
                    children: rowCells.map((cell: any, cellIndex: number) => {
                      const normalizedCell =
                        cell && typeof cell === 'object' && !Array.isArray(cell)
                          ? cell
                          : { content: typeof cell === 'string' ? [cell] : cell };
                      const cellBackground = normalizeDocxColor(normalizedCell.props?.backgroundColor);
                      const widthSize =
                        totalColumnWidth > 0 && Number(columnWidths[cellIndex]) > 0
                          ? Math.max(5, Math.round((Number(columnWidths[cellIndex]) / totalColumnWidth) * 100))
                          : Math.max(10, Math.round(100 / Math.max(1, rowCells.length)));

                      return new TableCell({
                        children: convertTableCellContent(normalizedCell.content, normalizedCell.props),
                        columnSpan:
                          Number(normalizedCell.props?.colspan) > 1
                            ? Number(normalizedCell.props.colspan)
                            : undefined,
                        rowSpan:
                          Number(normalizedCell.props?.rowspan) > 1
                            ? Number(normalizedCell.props.rowspan)
                            : undefined,
                        width: { size: widthSize, type: WidthType.PERCENTAGE },
                        shading:
                          cellBackground || rowIndex < headerRows
                            ? {
                                fill: cellBackground ?? 'F8F9FA',
                                type: ShadingType.CLEAR,
                              }
                            : undefined,
                      });
                    }),
                  });
                }),
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
                borders: subtleTableBorders,
              }),
            );
            children.push(new Paragraph({ text: ' ', spacing: { after: 80 } }));
          } else if (block.type === 'image') {
            const src = typeof block.props?.url === 'string' ? block.props.url : '';
            if (src) {
              try {
                const { data, imageType, width, height } = await loadImageAsset(src);
                if (imageType) {
                  const scaled = getScaledImageSize(
                    width,
                    height,
                    Math.min(520, Number(block.props?.previewWidth) || 520),
                  );
                  children.push(
                    new Paragraph({
                      alignment: alignmentFromValue(block.props?.textAlignment),
                      spacing: { after: block.props?.caption ? 80 : 160 },
                      children: [
                        new ImageRun({
                          type: imageType,
                          data,
                          transformation: scaled,
                          altText: {
                            title: block.props?.name || block.props?.caption || 'Image',
                            description: block.props?.caption || block.props?.name || 'Image',
                            name: block.props?.name || 'image',
                          },
                        }),
                      ],
                    }),
                  );
                }
              } catch (error) {
                console.error('Failed to embed AI editor DOCX export image:', error);
              }
            }

            if (normalizeTextContent(block.props?.caption)) {
              children.push(
                new Paragraph({
                  text: normalizeTextContent(block.props?.caption),
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 160 },
                }),
              );
            }
          } else if (block.type === 'file') {
            const fileLabel =
              normalizeTextContent(block.props?.name) ||
              normalizeTextContent(block.props?.url) ||
              'Attachment';
            const fileRuns = [new TextRun({ text: fileLabel })];
            children.push(
              new Paragraph({
                spacing: { after: 140 },
                children:
                  typeof block.props?.url === 'string' && block.props.url
                    ? [new ExternalHyperlink({ link: block.props.url, children: fileRuns })]
                    : fileRuns,
              }),
            );
          } else {
            children.push(
              createParagraphForBlock(
                block,
                getRunsFromInlineItems(getInlineItems(block.content)),
                listDepth,
              ),
            );
          }

          if (Array.isArray(block.children) && block.children.length > 0) {
            children.push(
              ...(await convertBlocksToDocxChildren(
                block.children,
                ['bulletListItem', 'numberedListItem', 'checkListItem'].includes(block.type)
                  ? listDepth + 1
                  : listDepth,
              )),
            );
          }
        }

        return children;
      };

      const children: any[] = [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: documentTitle || 'Document', bold: true, size: 32 })],
          spacing: { after: 220 },
        }),
        ...(await convertBlocksToDocxChildren(editor.document as any[])),
      ];

      const doc = new Document({
        numbering: {
          config: [
            {
              reference: 'ai-editor-bullets',
              levels: Array.from({ length: 9 }, (_, level) => ({
                level,
                format: LevelFormat.BULLET,
                text: ['•', '◦', '▪'][level % 3],
                alignment: AlignmentType.LEFT,
                suffix: LevelSuffix.SPACE,
                style: {
                  paragraph: {
                    indent: {
                      left: 720 + level * 360,
                      hanging: 240,
                    },
                  },
                },
              })),
            },
            {
              reference: 'ai-editor-numbered',
              levels: Array.from({ length: 9 }, (_, level) => ({
                level,
                format:
                  level % 3 === 0
                    ? LevelFormat.DECIMAL
                    : level % 3 === 1
                      ? LevelFormat.LOWER_LETTER
                      : LevelFormat.LOWER_ROMAN,
                text: `%${level + 1}.`,
                alignment: AlignmentType.LEFT,
                suffix: LevelSuffix.SPACE,
                style: {
                  paragraph: {
                    indent: {
                      left: 720 + level * 360,
                      hanging: 240,
                    },
                  },
                },
              })),
            },
          ],
        },
        sections: [{ children }],
      });
      const blob = await Packer.toBlob(doc);
      return blob;
    } catch (error) {
      console.error('Failed to export AI editor document as DOCX:', error);
      throw error;
    }
  }, [editor]);

  /** Word export on the server (footnotes, comments, tracked changes, page setup, original
   * styles); the in-browser export stays as a fallback. */
  const exportFromServer = useCallback(async (format: 'docx' | 'pdf' | 'latex') => {
    if (!editor) return null;
    return exportWordDocument({
      documentId,
      title: documentTitle,
      blocks: editor.document as any[],
      comments: (documentComments || []).filter((comment: any) => comment?.status !== 'deleted'),
      settings: wordSettings,
      format,
    });
  }, [documentComments, documentId, documentTitle, editor, wordSettings]);

  const handleExportDocx = useCallback(async () => {
    const pending = toast.loading('Preparing the Word file…');
    try {
      const blob = await exportFromServer('docx').catch(async (error) => {
        console.warn('Server Word export failed; using the in-browser export', error);
        return generateDocxBlob();
      });
      if (blob) downloadBlob(blob, createExportFilename(documentTitle, 'docx'));
      toast.dismiss(pending);
    } catch {
      toast.error('Word export failed. Please try again.', { id: pending });
    }
  }, [documentTitle, exportFromServer, generateDocxBlob]);

  const handleExportPdf = useCallback(async () => {
    const pending = toast.loading('Preparing the PDF…');
    try {
      const serverPdf = await exportFromServer('pdf').catch(() => null);
      if (serverPdf) {
        downloadBlob(serverPdf, createExportFilename(documentTitle, 'pdf'));
        toast.dismiss(pending);
        return;
      }
      toast.dismiss(pending);
      const blob = await generateDocxBlob();
      if (!blob) return;
      const formData = new FormData();
      formData.append('file', blob, createExportFilename(documentTitle, 'docx'));
      const pdfBlob = await postDurableArtifactForm(
        `${getHost()}/api/ai-editor/documents/convert/docx-to-pdf`,
        formData,
        { requestId: crypto.randomUUID() },
      );
      downloadBlob(pdfBlob, createExportFilename(documentTitle, 'pdf'));
    } catch {
      toast.error('PDF export failed. Please try again.');
    }
  }, [documentTitle, exportFromServer, generateDocxBlob]);

  const handleExportLatex = useCallback(async () => {
    const pending = toast.loading('Preparing the LaTeX files…');
    try {
      const blob = await exportFromServer('latex');
      if (blob) downloadBlob(blob, createExportFilename(documentTitle, 'zip').replace(/\.zip$/, '-latex.zip'));
      toast.dismiss(pending);
    } catch {
      toast.error('LaTeX export failed. Please try again.', { id: pending });
    }
  }, [documentTitle, exportFromServer]);

  const handleCopyDocument = useCallback(async () => {
    if (!editor) return;
    try {
      const html = await editor.blocksToHTMLLossy(editor.document as any);
      const text = await editor.blocksToMarkdownLossy(editor.document as any);
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast.success('Document copied');
    } catch {
      toast.error('Your browser blocked copying. Select all (Ctrl+A) and copy instead.');
    }
  }, [editor]);

  const handleImportDocument = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file || !editor || !canEdit) {
        return;
      }

      if (WORD_OPENABLE.test(file.name) && documentId) {
        // Word files are converted on the server, keeping their formatting, footnotes,
        // comments, tracked changes, citations and page setup.
        const pending = toast.loading(`Opening ${file.name}…`);
        try {
          const result = await importWordFile(file, documentId);
          runEditorAction((currentEditor) => {
            currentEditor.replaceBlocks(currentEditor.document, result.blocks as any);
          });
          if (result.title) onDocumentTitleChange(result.title);
          if (result.settings) onWordSettingsChange?.(result.settings);
          toast.success(result.warnings.length ? `Opened. ${result.warnings[0]}` : 'Opened with its Word formatting', { id: pending });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Import failed.', { id: pending });
        }
        return;
      }

      try {
        const lowerName = file.name.toLowerCase();
        let importedHtml: string | null = null;
        let importedMarkdownOrText = '';

        if (lowerName.endsWith('.docx')) {
          const mammoth = await import('mammoth');
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.convertToHtml(
            { arrayBuffer },
            {
              includeDefaultStyleMap: true,
              includeEmbeddedStyleMap: true,
              ignoreEmptyParagraphs: false,
              styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh",
                "p[style-name='Quote'] => blockquote:fresh",
                "p[style-name='Intense Quote'] => blockquote:fresh",
                'u => u',
                'strike => s',
              ],
              convertImage: mammoth.images.imgElement(async (image: any) => ({
                src: `data:${image.contentType};base64,${await image.readAsBase64String()}`,
              })),
            } as any,
          );
          if (Array.isArray(result.messages) && result.messages.length > 0) {
            console.warn('Mammoth DOCX import messages:', result.messages);
          }
          importedHtml = preprocessRichDocumentHtml(result.value || '');
        } else {
          const rawContent = await file.text();
          if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
            importedHtml = preprocessRichDocumentHtml(rawContent);
          } else {
            importedMarkdownOrText = rawContent;
          }
        }

        runEditorAction((currentEditor) => {
          let importedBlocks: Block<any, any, any>[] = [];

          if (importedHtml) {
            importedBlocks = currentEditor.tryParseHTMLToBlocks(importedHtml);
          } else {
            importedBlocks = currentEditor.tryParseMarkdownToBlocks(importedMarkdownOrText);
          }

          currentEditor.replaceBlocks(
            currentEditor.document,
            (importedBlocks.length > 0
              ? importedBlocks
              : [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: importedMarkdownOrText, styles: {} }],
                  } as any,
                ]) as any,
          );
        });

        const nextTitle = file.name.replace(/\.[^.]+$/, '').trim();
        if (nextTitle) {
          onDocumentTitleChange(nextTitle);
        }
      } catch (error) {
        console.error('Failed to import AI editor document:', error);
        toast.error('Import failed. Try a DOCX, HTML, Markdown, or text file.');
      }
    },
    [canEdit, documentId, editor, onDocumentTitleChange, onWordSettingsChange, runEditorAction],
  );

  const handleOpenAssistantLauncher = useCallback(() => {
    const selectedText = editor?.getSelectedText().trim() ?? '';
    const fallbackText =
      editor?.document
        .map((block) => getPlainTextFromBlockContent(block.content))
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 1200) ?? '';

    setAssistantContext(selectedText || fallbackText);
    setIsGeminiDialogOpen(true);
  }, [editor]);

  const handleLaunchAssistantTool = useCallback(
    async (path: string) => {
      const context = assistantContext.trim();
      if (typeof window !== 'undefined') {
        if (context) {
          window.sessionStorage.setItem('ai-editor-assistant-context', context);
          try {
            await navigator.clipboard.writeText(context);
          } catch (error) {
            console.error('Failed to copy assistant context:', error);
          }
        }

        window.open(path, '_blank', 'noopener,noreferrer');
      }

      setIsGeminiDialogOpen(false);
    },
    [assistantContext],
  );

  const handleOpenCitationDialog = useCallback(() => {
    const selectedText = editor?.getSelectedText().trim() ?? '';
    setCitationLabel(selectedText || '');
    setCitationUrl('');
    setIsCitationDialogOpen(true);
  }, [editor]);

  const handleInsertCitation = useCallback(() => {
    const trimmedLabel = citationLabel.trim();
    const trimmedUrl = citationUrl.trim();
    if (!trimmedLabel) {
      return;
    }

    const citationText = /^\[.*\]$/.test(trimmedLabel) ? trimmedLabel : `[${trimmedLabel}]`;
    runEditorAction((currentEditor) => {
      if (trimmedUrl) {
        currentEditor.createLink(trimmedUrl, citationText);
        return;
      }

      currentEditor.insertInlineContent([citationText]);
    });

    if (documentId && typeof window !== 'undefined') {
      const nextCitations = [
        { id: crypto.randomUUID(), label: trimmedLabel, url: trimmedUrl || undefined },
        ...savedCitations.filter((entry) => entry.label !== trimmedLabel || entry.url !== (trimmedUrl || undefined)),
      ];
      setSavedCitations(nextCitations);
      window.localStorage.setItem(`ai-editor-citations:${documentId}`, JSON.stringify(nextCitations));
    }

    setIsCitationDialogOpen(false);
  }, [citationLabel, citationUrl, documentId, runEditorAction, savedCitations]);

  const handleInsertBibliography = useCallback(() => {
    if (!savedCitations.length) {
      toast('Add at least one citation before inserting a bibliography.');
      return;
    }

    runEditorAction((currentEditor) => {
      const referenceBlock =
        getPrimarySelectedBlock(currentEditor) ?? currentEditor.document[currentEditor.document.length - 1];

      if (!referenceBlock) {
        return;
      }

      currentEditor.insertBlocks(
        [
          {
            type: 'heading',
            props: { level: 2 },
            content: [{ type: 'text', text: 'Bibliography', styles: {} }],
          } as any,
          ...savedCitations.map((entry) => ({
            type: 'numberedListItem',
            content: [
              {
                type: 'text',
                text: entry.url ? `${entry.label} — ${entry.url}` : entry.label,
                styles: {},
              },
            ],
          })),
        ] as any,
        referenceBlock,
        'after',
      );
    });
  }, [runEditorAction, savedCitations]);

  const handleOpenEquationDialog = useCallback(() => {
    setEquationValue(editor?.getSelectedText().trim() ?? '');
    setIsEquationDialogOpen(true);
  }, [editor]);

  const persistListVariants = useCallback(
    (nextValue: StoredListVariants) => {
      setListVariants(nextValue);
      if (documentId && typeof window !== 'undefined') {
        window.localStorage.setItem(`ai-editor-list-variants:${documentId}`, JSON.stringify(nextValue));
      }
    },
    [documentId],
  );

  // List styles are rendered from a stylesheet keyed by block id. This used to
  // write data-list-variant attributes onto the editor's own DOM from a
  // MutationObserver: ProseMirror treats foreign attribute changes as DOM edits
  // and redraws the list, which removed the attributes, which the observer put
  // back, forever. Choosing e.g. "Hollow bullets" froze the tab. The observer
  // below only reads the editor DOM (for list numbering) and writes a <style>
  // element outside it, so it cannot feed itself.
  const applyListVariantStyles = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const rules: string[] = [];
    const root = document.querySelector('.ai-editor-blocknote');
    const blockSelector = (blockId: string, contentType: string) =>
      `.ai-editor-blocknote [data-id="${cssStringValue(blockId)}"] > .bn-block-content[data-content-type="${contentType}"]`;

    root?.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="bulletListItem"]').forEach((node) => {
      const blockId = node.closest('[data-id]')?.getAttribute('data-id');
      const variant = blockId ? listVariants.bullet[blockId] : undefined;
      const marker = variant === 'hollow' ? '◦' : variant === 'diamond' ? '◆' : null;
      if (blockId && marker) {
        rules.push(`${blockSelector(blockId, 'bulletListItem')}::before { content: "${marker}" !important; }`);
      }
    });

    root?.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="numberedListItem"]').forEach((node) => {
      const blockId = node.closest('[data-id]')?.getAttribute('data-id');
      const variant = blockId ? listVariants.numbered[blockId] : undefined;
      if (!blockId || (variant !== 'bracket' && variant !== 'roman')) {
        return;
      }
      const index = Number.parseInt(node.getAttribute('data-index') || '1', 10) || 1;
      const display = variant === 'roman' ? `${toRomanNumeral(index)}.` : `${index})`;
      rules.push(`${blockSelector(blockId, 'numberedListItem')}::before { content: "${cssStringValue(display)}" !important; }`);
    });

    root?.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="checkListItem"]').forEach((node) => {
      const blockId = node.closest('[data-id]')?.getAttribute('data-id');
      if (blockId && listVariants.checklist[blockId] === 'subtasks') {
        rules.push(`${blockSelector(blockId, 'checkListItem')} > div > input { accent-color: #7c3aed; }`);
      }
    });

    const css = rules.join('\n');
    let styleElement = document.getElementById(LIST_VARIANT_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!styleElement) {
      if (!css) {
        return;
      }
      styleElement = document.createElement('style');
      styleElement.id = LIST_VARIANT_STYLE_ELEMENT_ID;
      document.head.appendChild(styleElement);
    }
    if (styleElement.textContent !== css) {
      styleElement.textContent = css;
    }
  }, [listVariants]);

  useEffect(() => {
    applyListVariantStyles();

    if (typeof document === 'undefined') {
      return;
    }

    const root = document.querySelector('.ai-editor-blocknote');
    if (!root) {
      return;
    }

    const observer = new MutationObserver(() => applyListVariantStyles());
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-index'] });

    return () => observer.disconnect();
  }, [applyListVariantStyles, editor]);

  useEffect(
    () => () => {
      document.getElementById(LIST_VARIANT_STYLE_ELEMENT_ID)?.remove();
    },
    [],
  );

  const handleAlignmentSelection = useCallback(
    (alignment: DocsTextAlignment) => {
      updateSelectedBlocks(() => ({
        props: { textAlignment: alignment },
      }));
      closeDropdown();
    },
    [updateSelectedBlocks],
  );

  const handleListToggle = useCallback(
    (listType: DocsListType) => {
      runEditorAction((currentEditor) => {
        const blocks = getTargetBlocks(currentEditor);
        const shouldResetToParagraph = blocks.every((block) => block.type === listType);

        blocks.forEach((block) => {
          currentEditor.updateBlock(block.id, {
            type: shouldResetToParagraph ? 'paragraph' : listType,
          } as any);
        });
      });
      closeDropdown();
    },
    [runEditorAction],
  );

  const handleLineSpacingSelection = useCallback(
    (option: string) => {
      // Space before/after is the paragraph's own spacing (12 pt, as in Word), not an empty line.
      const spacingSide = /space before/.test(option) ? 'spaceBefore' : /space after/.test(option) ? 'spaceAfter' : null;
      if (spacingSide) {
        runEditorAction((currentEditor) => {
          setParagraphProps(currentEditor, (props) => ({ [spacingSide]: props[spacingSide] ? '' : '12' }));
        });
        closeDropdown();
        return;
      }

      if (option === 'Custom spacing') {
        closeDropdown();
        void editorPrompt({
          title: 'Custom line spacing',
          label: 'Line spacing (for example 1.15, 1.5 or 2)',
          defaultValue: String(((editor && getPrimarySelectedBlock(editor)?.props) as Record<string, any> | undefined)?.lineSpacing || '1.15'),
          okLabel: 'Apply',
        }).then((customValue) => {
          if (!customValue) return;
          runEditorAction((currentEditor) => {
            setParagraphProps(currentEditor, () => ({ lineSpacing: normalizeLineSpacingValue(customValue) }));
          });
        });
        return;
      }

      const spacingMap: Record<string, string> = {
        Single: '1',
        '1.15': '1.15',
        '1.5': '1.5',
        Double: '2',
      };

      const nextValue = spacingMap[option];
      if (!nextValue) {
        closeDropdown();
        return;
      }

      runEditorAction((currentEditor) => {
        setParagraphProps(currentEditor, () => ({ lineSpacing: nextValue }));
      });
      closeDropdown();
    },
    [editor, runEditorAction],
  );

  const handleChecklistVariantSelection = useCallback(
    (option: string) => {
      const variant = option === 'Checklist with subtasks' ? 'subtasks' : 'checklist';
      runEditorAction((currentEditor) => {
        const blocks = getTargetBlocks(currentEditor);
        const nextChecklist = { ...listVariants.checklist };

        blocks.forEach((block) => {
          nextChecklist[block.id] = variant;
          currentEditor.updateBlock(block.id, {
            type: 'checkListItem',
            children:
              variant === 'subtasks' && (!Array.isArray(block.children) || block.children.length === 0)
                ? [
                    {
                      id: crypto.randomUUID(),
                      type: 'checkListItem',
                      props: { checked: false },
                      content: [],
                      children: [],
                    },
                  ]
                : block.children,
          } as any);
        });

        persistListVariants({
          ...listVariants,
          checklist: nextChecklist,
        });
      });
      closeDropdown();
    },
    [listVariants, persistListVariants, runEditorAction],
  );

  const handleBulletVariantSelection = useCallback(
    (option: string) => {
      const variantMap: Record<string, 'standard' | 'hollow' | 'diamond'> = {
        'Standard bullets': 'standard',
        'Hollow bullets': 'hollow',
        'Diamond bullets': 'diamond',
      };
      const nextVariant = variantMap[option];
      if (!nextVariant) {
        closeDropdown();
        return;
      }

      runEditorAction((currentEditor) => {
        const blocks = getTargetBlocks(currentEditor);
        const nextBullet = { ...listVariants.bullet };

        blocks.forEach((block) => {
          nextBullet[block.id] = nextVariant;
          currentEditor.updateBlock(block.id, { type: 'bulletListItem' } as any);
        });

        persistListVariants({
          ...listVariants,
          bullet: nextBullet,
        });
      });
      closeDropdown();
    },
    [listVariants, persistListVariants, runEditorAction],
  );

  const handleNumberVariantSelection = useCallback(
    (option: string) => {
      const variantMap: Record<string, 'standard' | 'bracket' | 'roman'> = {
        '1. 2. 3.': 'standard',
        '1) 2) 3)': 'bracket',
        'I. II. III.': 'roman',
      };
      const nextVariant = variantMap[option];
      if (!nextVariant) {
        closeDropdown();
        return;
      }

      runEditorAction((currentEditor) => {
        const blocks = getTargetBlocks(currentEditor);
        const nextNumbered = { ...listVariants.numbered };

        blocks.forEach((block) => {
          nextNumbered[block.id] = nextVariant;
          currentEditor.updateBlock(block.id, { type: 'numberedListItem' } as any);
        });

        persistListVariants({
          ...listVariants,
          numbered: nextNumbered,
        });
      });
      closeDropdown();
    },
    [listVariants, persistListVariants, runEditorAction],
  );

  const handleClearFormatting = useCallback(() => {
    runEditorAction((currentEditor) => {
      currentEditor.removeStyles({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        textColor: 'default',
        backgroundColor: 'default',
        fontFamily: '',
        fontSize: '',
        fontWeight: '',
        verticalAlign: '',
        lineHeight: '',
      } as any);

      getTargetBlocks(currentEditor).forEach((block) => {
        if (
          block.type === 'paragraph' ||
          block.type === 'heading' ||
          block.type === 'bulletListItem' ||
          block.type === 'numberedListItem' ||
          block.type === 'checkListItem' ||
          block.type === 'quote'
        ) {
          currentEditor.updateBlock(block.id, {
            type: 'paragraph',
            props: {
              textAlignment: 'left',
              textColor: 'default',
              backgroundColor: 'default',
            },
          } as any);
        }
      });
    });
  }, [runEditorAction]);

  const handleInsertPageBreak = useCallback(() => {
    runEditorAction((currentEditor) => {
      const referenceBlock =
        getPrimarySelectedBlock(currentEditor) ?? currentEditor.document[currentEditor.document.length - 1];

      if (!referenceBlock) {
        return;
      }

      currentEditor.insertBlocks([{ type: 'pageBreak' as any }], referenceBlock, 'after');
    });
  }, [runEditorAction]);

  const handleVerticalAlignToggle = useCallback(
    (alignment: 'super' | 'sub') => {
      runEditorAction((currentEditor) => {
        const isActive = activeStyles.verticalAlign === alignment;
        if (isActive) {
          currentEditor.removeStyles({ verticalAlign: alignment } as any);
          return;
        }

        currentEditor.addStyles({ verticalAlign: alignment } as any);
      });
    },
    [activeStyles.verticalAlign, runEditorAction],
  );

  const handleInsertDivider = useCallback(() => {
    runEditorAction((currentEditor) => {
      const referenceBlock =
        getPrimarySelectedBlock(currentEditor) ?? currentEditor.document[currentEditor.document.length - 1];

      if (!referenceBlock) {
        return;
      }

      currentEditor.insertBlocks([{ type: 'divider' as any }], referenceBlock, 'after');
    });
  }, [runEditorAction]);

  const insertBlockAfterSelection = useCallback(
    (block: Record<string, unknown>) => {
      runEditorAction((currentEditor) => {
        const referenceBlock =
          getPrimarySelectedBlock(currentEditor) ?? currentEditor.document[currentEditor.document.length - 1];

        if (!referenceBlock) {
          return;
        }

        currentEditor.insertBlocks([block as any], referenceBlock, 'after');
      });
    },
    [runEditorAction],
  );

  const handleInsertTable = useCallback(() => {
    insertBlockAfterSelection({
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: ['Header 1', 'Header 2', 'Header 3'],
          },
          {
            cells: ['', '', ''],
          },
        ],
      },
    });
  }, [insertBlockAfterSelection]);

  const withSelectedTable = useCallback(
    (
      action: (context: {
        currentEditor: DocsEditor;
        block: DocsBlock;
        tableHandles: any;
        anchor: { row: number; col: number };
        selection: any;
      }) => void,
    ) => {
      runEditorAction((currentEditor) => {
        const context = getSelectedTableContext(currentEditor);
        if (!context.block || !context.tableHandles || !context.anchor) {
          return;
        }

        action({
          currentEditor,
          block: context.block,
          tableHandles: context.tableHandles,
          anchor: context.anchor,
          selection: context.selection,
        });
      });
    },
    [runEditorAction],
  );

  const normalizeEditableTableCell = useCallback((cell: any) => {
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
      return {
        ...cell,
        props: {
          ...(cell.props ?? {}),
        },
      };
    }

    return {
      type: 'tableCell',
      content:
        typeof cell === 'string'
          ? [{ type: 'text', text: cell, styles: {} }]
          : Array.isArray(cell)
            ? cell
            : [],
      props: {},
    };
  }, []);

  const applyTableAxisColor = useCallback(
    (axis: 'row' | 'column', color: string) => {
      withSelectedTable(({ currentEditor, block, tableHandles, anchor }) => {
        const targetCells =
          axis === 'row'
            ? tableHandles.getCellsAtRowHandle?.(block, anchor.row) ?? []
            : tableHandles.getCellsAtColumnHandle?.(block, anchor.col) ?? [];
        const targetCellSet = new Set(targetCells.map((entry: any) => entry.cell));
        const nextRows = (Array.isArray((block as any).content?.rows) ? (block as any).content.rows : []).map(
          (row: any) => ({
            ...row,
            cells: (Array.isArray(row?.cells) ? row.cells : []).map((cell: any) => {
              if (!targetCellSet.has(cell)) {
                return cell;
              }

              const editableCell = normalizeEditableTableCell(cell);
              return {
                ...editableCell,
                props: {
                  ...editableCell.props,
                  backgroundColor: color === 'default' ? 'default' : color,
                },
              };
            }),
          }),
        );

        currentEditor.updateBlock((block as any).id, {
          content: {
            ...(block as any).content,
            rows: nextRows,
          },
        } as any);
      });
      closeDropdown();
    },
    [closeDropdown, normalizeEditableTableCell, withSelectedTable],
  );

  const handleTableStructureAction = useCallback(
    (
      action:
        | 'add-row-above'
        | 'add-row-below'
        | 'remove-row'
        | 'add-column-left'
        | 'add-column-right'
        | 'remove-column'
        | 'remove-table',
    ) => {
      withSelectedTable(({ currentEditor, block, tableHandles, anchor }) => {
        if (action === 'remove-table') {
          currentEditor.removeBlocks([(block as any).id]);
          return;
        }

        if (action === 'add-row-above') {
          tableHandles.addRowOrColumn?.(anchor.row, { orientation: 'row', side: 'above' });
          return;
        }

        if (action === 'add-row-below') {
          tableHandles.addRowOrColumn?.(anchor.row, { orientation: 'row', side: 'below' });
          return;
        }

        if (action === 'remove-row') {
          tableHandles.removeRowOrColumn?.(anchor.row, 'row');
          return;
        }

        if (action === 'add-column-left') {
          tableHandles.addRowOrColumn?.(anchor.col, { orientation: 'column', side: 'left' });
          return;
        }

        if (action === 'add-column-right') {
          tableHandles.addRowOrColumn?.(anchor.col, { orientation: 'column', side: 'right' });
          return;
        }

        if (action === 'remove-column') {
          tableHandles.removeRowOrColumn?.(anchor.col, 'column');
        }
      });
      closeDropdown();
    },
    [closeDropdown, withSelectedTable],
  );

  const handleInsertEquation = useCallback(() => {
    const trimmedEquation = equationValue.trim();
    if (!trimmedEquation) {
      return;
    }

    insertBlockAfterSelection({ type: 'equation', props: { latex: trimmedEquation, autoOpen: 'false' } });
    setIsEquationDialogOpen(false);
  }, [equationValue, insertBlockAfterSelection]);

  const handleInsertImageFromUrl = useCallback(
    (rawUrl: string, name?: string) => {
      const trimmedUrl = rawUrl.trim();
      if (!trimmedUrl) {
        return;
      }

      const normalizedUrl = /^(https?:\/\/|data:image\/)/i.test(trimmedUrl)
        ? trimmedUrl
        : `https://${trimmedUrl.replace(/^\/+/, '')}`;

      insertBlockAfterSelection({
        type: 'image',
        props: {
          url: normalizedUrl,
          name: name ?? 'Inserted image',
          caption: '',
          showPreview: true,
        },
      });
      closeDropdown();
    },
    [insertBlockAfterSelection],
  );

  const promptForImageUrl = useCallback(
    (label: string, placeholder: string) => {
      void editorPrompt({ title: 'Insert image', label, defaultValue: placeholder, okLabel: 'Insert' }).then((nextUrl) => {
        if (nextUrl && nextUrl !== placeholder) handleInsertImageFromUrl(nextUrl);
      });
    },
    [handleInsertImageFromUrl],
  );

  const handleImageUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result) {
          return;
        }

        handleInsertImageFromUrl(result, file.name);
      };
      reader.readAsDataURL(file);

      event.target.value = '';
    },
    [handleInsertImageFromUrl],
  );

  const handleCameraImageCapture = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result) {
          return;
        }

        handleInsertImageFromUrl(result, file.name || 'Camera image');
      };
      reader.readAsDataURL(file);

      event.target.value = '';
    },
    [handleInsertImageFromUrl],
  );

  const handleInsertFileFromUrl = useCallback(
    (rawUrl: string, name?: string) => {
      const trimmedUrl = rawUrl.trim();
      if (!trimmedUrl) {
        return;
      }

      const normalizedUrl = /^(https?:\/\/|data:|blob:)/i.test(trimmedUrl)
        ? trimmedUrl
        : `https://${trimmedUrl.replace(/^\/+/, '')}`;

      insertBlockAfterSelection({
        type: 'file',
        props: {
          url: normalizedUrl,
          name: name ?? 'Attached file',
          caption: '',
        },
      });
      closeDropdown();
    },
    [insertBlockAfterSelection],
  );

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result) {
          return;
        }

        handleInsertFileFromUrl(result, file.name);
      };
      reader.readAsDataURL(file);

      event.target.value = '';
    },
    [handleInsertFileFromUrl],
  );

  const currentUserInitials = currentUserDisplayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'AI';
  const shareSummary =
    sharedMembers.length === 0
      ? isLinkSharingEnabled
        ? 'Anyone with link can open'
        : 'Private'
      : `Shared with ${sharedMembers[0].email}` +
        (sharedMembers.length > 1 ? ` + ${sharedMembers.length - 1} more` : '');


  const handleCopyAsMarkdown = async () => {
    if (!editor) return;
    try {
      const selected = editor.getSelection()?.blocks;
      const markdown = await Promise.resolve(editor.blocksToMarkdownLossy(selected?.length ? selected : editor.document));
      await navigator.clipboard.writeText(markdown);
      toast.success(selected?.length ? 'Selection copied as Markdown' : 'Document copied as Markdown');
    } catch {
      toast.error('Could not copy to the clipboard. Allow clipboard access and try again.');
    }
  };

  const handlePasteFromMarkdown = async () => {
    if (!editor || !canEdit) return;
    try {
      const markdown = await navigator.clipboard.readText();
      if (!markdown.trim()) {
        toast('The clipboard is empty.');
        return;
      }
      const blocks = await Promise.resolve(editor.tryParseMarkdownToBlocks(markdown));
      runEditorAction((currentEditor) => {
        currentEditor.insertBlocks(blocks, currentEditor.getTextCursorPosition().block, 'after');
      });
    } catch {
      toast.error('Could not read the clipboard. Allow clipboard access and try again.');
    }
  };

  // AI controls: one menu on wide screens, a section of the phone sheet.
  const renderAIControls = (onDone: () => void, roomy = false) => {
    const row = `flex w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[#0f172a] transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-60 ${roomy ? 'min-h-[46px] text-[15px]' : 'min-h-[34px] text-[13.5px]'}`;
    return (
    <div>
      <button
        type="button"
        onClick={() => {
          onDone();
          onStartWritingClick?.();
        }}
        disabled={!canEdit || isAIWritingActive}
        aria-busy={isAIWritingLoading}
        title="Draft a section from your topic and sources"
        className={row}
      >
        <span className="flex w-4 shrink-0 justify-center text-[var(--theme-primary)]"><LuSparkles className="h-4 w-4" /></span>
        <span className="flex-1">{writeWithAiLabel}</span>
      </button>
      {[
        { label: 'Autocomplete', hint: 'Grey text suggests your next sentence', checked: Boolean(aiWritingSuggestionsEnabled), onToggle: onToggleAIWritingSuggestions },
        { label: 'Live review', hint: 'Flags weak claims and missing citations as you write', checked: Boolean(aiReviewSuggestionsEnabled), onToggle: onToggleAIReviewSuggestions },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          role="switch"
          aria-checked={option.checked}
          title={option.hint}
          disabled={!canEdit}
          onClick={() => option.onToggle?.()}
          className={row}
        >
          <span className="w-4 shrink-0" />
          <span className="flex-1">{option.label}</span>
          <span className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${option.checked ? 'bg-[var(--theme-primary)]' : 'bg-[#cbd5e1]'}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.2)] transition-all ${option.checked ? 'left-[14px]' : 'left-[2px]'}`} />
          </span>
        </button>
      ))}
      {onViewAndHumanizeClick ? (
        <button
          type="button"
          onClick={() => {
            onDone();
            onViewAndHumanizeClick();
          }}
          className={row}
        >
          <span className="w-4 shrink-0" />
          <span className="flex-1">AI detection</span>
          {flaggedCount ? <span className="text-[12px] text-[#c5221f]">{flaggedCount} flagged</span> : null}
        </button>
      ) : null}
    </div>
    );
  };

  const handleTopMenuItemSelect = (item: MenuItem) => {
      if (item.label === 'Print') {
        onPrintClick?.();
      }
      if (item.label === 'Mode') {
        setOpenDropdown('select-mode');
        return;
      }
      if (item.label === 'Comments') {
        onShowCommentsClick?.();
        closeDropdown();
        return;
      }
      if (item.label === 'Version history') {
        onVersionHistoryClick();
      }
      if (item.label === 'Copy as Markdown') {
        void handleCopyAsMarkdown();
      }
      if (item.label === 'Paste from Markdown') {
        void handlePasteFromMarkdown();
      }
      if (item.label === 'Undo') {
        runEditorAction((currentEditor) => {
          currentEditor.undo();
        });
      }
      if (item.label === 'Redo') {
        runEditorAction((currentEditor) => {
          currentEditor.redo();
        });
      }
      if (item.label === 'New') {
        onCreateDocumentClick?.();
      }
      if (item.label === 'Open') {
        onDocsHomeClick?.();
      }
      if (item.label === 'Open in new tab') {
        window.open(editorPath(), '_blank', 'noopener,noreferrer');
      }
      if (item.label === 'Make a copy') {
        onDuplicateDocumentClick?.();
      }
      if (item.label === DOWNLOAD_TEXT_LABEL || item.label === 'Export as plain text') {
        handleDownloadDocument();
      }
      if (item.label === 'Import from file') {
        importDocumentInputRef.current?.click();
      }
      if (item.label === DOWNLOAD_DOCX_LABEL || item.label === 'Export as DOCX') {
        void handleExportDocx();
      }
      if (item.label === DOWNLOAD_PDF_LABEL || item.label === 'Export as PDF') {
        void handleExportPdf();
      }
      if (item.label === DOWNLOAD_LATEX_LABEL) {
        void handleExportLatex();
      }
      if (item.label === 'Copy document') {
        void handleCopyDocument();
      }
      if (item.label === 'Insert citation') {
        onInsertCitation?.();
      }
      if (item.label === 'Find papers') {
        onOpenAssistant?.('papers');
      }
      if (item.label === 'Library') {
        onOpenAssistant?.('library');
      }
      if (item.label === 'Inline equation') {
        onInsertInlineEquation?.();
      }
      if (item.label === 'Email' || item.label === 'Email collaborators') {
        const subject = encodeURIComponent(documentTitle);
        const body = encodeURIComponent(
          `I wanted to share this document with you:\n${window.location.origin}${editorPath()}?doc=${documentId ?? ''}`,
        );
        window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
      }
      if (item.label === 'Details') {
        setIsDetailsDialogOpen(true);
      }
      if (item.label === 'Language') {
        void editorPrompt({
          title: 'Document language',
          message: 'Used for spelling and by the AI when it writes for you.',
          options: DOCUMENT_LANGUAGES.map((language) => ({ value: language.label, label: language.label })),
          defaultValue: DOCUMENT_LANGUAGES.some((language) => language.label === documentLanguage) ? documentLanguage : 'English',
          okLabel: 'Set language',
        }).then((nextLanguage) => {
          if (nextLanguage) handleLanguageSelection(nextLanguage);
        });
      }
      if (item.label === 'Move to trash') {
        void editorConfirm({ title: 'Move this document to trash?', message: 'You can no longer open it from your documents.', okLabel: 'Move to trash', danger: true }).then((confirmed) => {
          if (confirmed) onDeleteDocumentClick?.();
        });
      }
      if (item.label === 'Print layout') {
        onPageViewToggle?.();
        toast.success(isPageView ? 'Pageless view' : 'Print layout');
      }
      if (item.label === 'Page setup') {
        setIsPageSetupDialogOpen(true);
      }
      if (item.label === 'Equation' || item.label === 'Equation toolbar') {
        insertBlockAfterSelection({ type: 'equation', props: { latex: '' } });
      }
      if (item.label === 'Add/edit citation') {
        handleOpenCitationDialog();
      }
      if (item.label === 'Add/edit bibliography' || item.label === 'Refresh') {
        handleInsertBibliography();
      }
      if (item.label === 'Cut') {
        void handleCutSelection();
      }
      if (item.label === 'Copy') {
        void handleCopySelection();
      }
      if (item.label === 'Paste' || item.label === 'Paste without formatting') {
        void handlePaste(item.label !== 'Paste');
      }
      if (item.label === 'Select all') {
        handleSelectAll();
      }
      if (item.label === 'Find') {
        handleFindInDocument();
      }
      if (item.label === 'Find and replace') {
        handleFindAndReplace();
      }
      if (item.label === 'Keyboard shortcuts') {
        setIsKeyboardShortcutsOpen(true);
      }
      if (item.label === 'Delete') {
        runEditorAction((currentEditor) => {
          const tiptapEditor = (currentEditor as any)._tiptapEditor;
          tiptapEditor?.chain().focus().deleteSelection().run();
        });
      }
      if (item.label === 'Rename') {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }
      if (item.label === 'Share') {
        onShareClick();
      }
      if (item.label === 'Copy link') {
        onCopyLinkClick();
      }
      if (item.label === 'Star') {
        onStarToggle?.();
      }
      if (item.label === 'Page break') {
        handleInsertPageBreak();
      }
      if (item.label === 'Footnote') {
        runEditorAction((currentEditor) => {
          currentEditor.insertInlineContent([{ type: 'footnote', props: { text: '', kind: 'footnote' } } as any]);
        });
      }
      if (item.label === 'Table of contents') {
        runEditorAction((currentEditor) => {
          const current = currentEditor.getTextCursorPosition().block;
          currentEditor.insertBlocks([{ type: 'tableOfContents' } as any], current, 'before');
        });
      }
      if (item.label === 'Horizontal line') {
        handleInsertDivider();
      }
    if (item.label === 'Table') {
      handleInsertTable();
    }
    if (item.label === 'Image') {
      setOpenDropdown('toolbar-insert-image');
      return;
    }
    if (item.label === 'Attachment') {
      fileUploadInputRef.current?.click();
      closeDropdown();
      return;
    }
    if (item.label === 'Link') {
      handleOpenLinkEditor();
      return; // the link editor is a dropdown; closing the menu below would close it too
    }
    if (item.label === 'Special characters') {
      setOpenDropdown('toolbar-special-characters');
      return;
    }
    if (item.label === 'Comment') {
      onCommentClick?.();
    }
    if (item.label === 'Bookmark') {
      onBookmarkClick?.();
    }
      if (item.label === 'Word count') {
        setIsWordCountOpen(true);
      }
      if (item.label === 'Spelling and grammar') {
        onSpellCheckToggle?.();
      }
      if (item.label === 'Paragraph styles') {
        setOpenDropdown('select-style');
        return;
      }
      if (item.label === 'Align & indent') {
        setOpenDropdown('select-align');
        return;
      }
      if (item.label === 'Line & paragraph spacing') {
        setOpenDropdown('select-spacing');
        return;
      }
      if (item.label === 'Bullets & numbering') {
        setOpenDropdown('select-bullets');
        return;
      }
      if (item.label === 'Clear formatting') {
        handleClearFormatting();
      }
      if (item.label === 'Show document outline') {
        onOutlineToggle?.();
      }
      if (item.label === 'Fit') {
        onZoomChange?.('Fit');
      }
      if (item.label === 'Zoom reset') {
        onZoomChange?.('100%');
      }
      if (item.label === 'Full screen') {
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        } else {
          void document.documentElement.requestFullscreen?.().catch(() => {});
        }
      }
      closeDropdown();
  };

  // Paint format (toolbar) and Format › Copy formatting (Ctrl+Alt+C): copy the selection's look.
  const togglePaintFormat = () => {
    if (paintFormatOn) {
      setPaintFormatOn(false);
      setCopiedFormatting(null);
      setPaintFormatSourceBlockId(null);
      return;
    }

    const formatSnapshot = Object.fromEntries(
      Object.entries(activeStyles).filter(([key, value]) => {
        return (
          ['bold', 'italic', 'underline', 'strike', 'textColor', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight'].includes(key) &&
          Boolean(value)
        );
      }),
    );

    if (Object.keys(formatSnapshot).length === 0) {
      toast('Paint format copies bold, italic, colours and fonts. Select text that has some first.');
      return;
    }

    setCopiedFormatting(formatSnapshot);
    setPaintFormatSourceBlockId(currentBlockId);
    setPaintFormatOn(true);
  };

  // Every shortcut the menus and tooltips show runs the same command as its menu item.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  shortcutRef.current = (event: KeyboardEvent) => {
    if (!editor || !document.querySelector('.ai-editor-blocknote')) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const target = event.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    const mod = event.ctrlKey || event.metaKey;
    const { code } = event;
    let command: string | undefined;
    if (mod && event.altKey && !event.shiftKey) {
      command = ({ KeyM: 'Comment', KeyN: 'New', KeyT: 'Table', KeyX: 'Spelling and grammar', KeyF: 'Footnote', KeyC: 'copy-formatting' } as Record<string, string>)[code];
    } else if (mod && event.shiftKey && !event.altKey) {
      command = ({ KeyC: 'Word count', KeyF: 'Full screen', KeyL: 'align-left', KeyE: 'align-center', KeyR: 'align-right', KeyJ: 'align-justify', Period: 'font-up', Comma: 'font-down' } as Record<string, string>)[code];
    } else if (mod && !event.shiftKey && !event.altKey) {
      command = ({ KeyO: 'Open', Slash: 'Keyboard shortcuts', Backslash: 'Clear formatting', Enter: 'Page break', KeyK: 'Link' } as Record<string, string>)[code];
    } else if (event.altKey && event.shiftKey && !mod && code === 'Digit5') {
      command = 'strike';
    } else if (event.altKey && !mod && !event.shiftKey && code === 'Slash') {
      command = 'search-menus';
    } else if (!mod && !event.altKey && !event.shiftKey && code === 'F2') {
      command = 'Rename';
    }
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    if (command.startsWith('align-')) handleAlignmentSelection(command.slice(6) as DocsTextAlignment);
    else if (command === 'font-up' || command === 'font-down') {
      const index = fontSizeOptions.indexOf(fontSizeValue);
      const next = command === 'font-up'
        ? fontSizeOptions[index >= 0 && index < fontSizeOptions.length - 1 ? index + 1 : fontSizeOptions.length - 1]
        : fontSizeOptions[index > 0 ? index - 1 : 0];
      applyFontSizeValue(next);
    } else if (command === 'strike') runEditorAction((currentEditor) => currentEditor.toggleStyles({ strike: true } as any));
    else if (command === 'copy-formatting') togglePaintFormat();
    else if (command === 'search-menus') {
      setSearchQuery('');
      setMoreMenuGroup(null);
      setOpenDropdown('toolbar-search');
    } else handleTopMenuItemSelect({ label: command });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcutRef.current(event);
    // Capture: before the editor's own keymap (it uses Ctrl+Shift+E and others differently).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const saveState = shortSaveState(documentStatusLabel);
  const visibleCollaborators = collaborators.length > 1 ? collaborators.slice(0, 4) : [];
  const showUpgrade = Boolean(account) && !isPaidPlan(account?.plan);
  const handleUpgrade = () => {
    if (editorConfig.onUpgrade) editorConfig.onUpgrade({ reason: 'editor' });
    else window.location.assign(navLink('pricing'));
  };
  const decorateMenuItem = (item: MenuItem): MenuItem => {
    if (item.label === 'Star') return { ...item, selected: isStarred };
    if (item.label === 'Print layout') return { ...item, selected: Boolean(isPageView) };
    if (item.label === 'Spelling and grammar') return { ...item, selected: spellCheckEnabled };
    if (item.label === 'Show document outline') return { ...item, selected: isOutlinePanelVisible };
    if (item.label === 'Fit') return { ...item, selected: zoomValue === 'Fit' };
    return item;
  };
  const handleMoreMenuSelect = (item: MenuItem) => {
    setSearchQuery('');
    setMoreMenuGroup(null);
    handleTopMenuItemSelect(item);
  };
  const moreMenuQuery = searchQuery.trim().toLowerCase();
  const moreMenuResults = moreMenuQuery
    ? topMenus.flatMap((menu) =>
        (topMenuItems[menu] ?? [])
          .filter((item) => item.label.toLowerCase().includes(moreMenuQuery) || (item.description ?? '').toLowerCase().includes(moreMenuQuery))
          .map((item) => ({ ...decorateMenuItem(item), description: item.description ? `${menu} · ${item.description}` : menu, dividerAfter: false })),
      )
    : [];
  const moreMenuGroupIcons: Record<string, React.ReactNode> = {
    File: <LuFileText className="h-4 w-4" />,
    Edit: <LuPencil className="h-4 w-4" />,
    View: <LuEye className="h-4 w-4" />,
    Insert: <LuPlus className="h-4 w-4" />,
    Format: <LuType className="h-4 w-4" />,
    Tools: <LuWrench className="h-4 w-4" />,
    Citations: <LuQuote className="h-4 w-4" />,
    AI: <LuSparkles className="h-4 w-4" />,
  };
  // The "⋯" menu: every command of the old File … Citations menus, grouped, plus a search.
  const renderMoreMenu = () => (
    <div className="flex flex-col">
      <label className="-mx-1 -mt-1 mb-1 flex h-10 items-center gap-2 border-b border-[#f1f5f9] px-3.5 text-[#94a3b8]">
        {ICON_SEARCH}
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setMoreMenuGroup(null);
          }}
          placeholder="Search…"
          aria-label="Search menus"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#0f172a] outline-none placeholder:text-[#94a3b8]"
        />
      </label>
      {moreMenuQuery ? (
        moreMenuResults.length ? (
          <DropdownList items={moreMenuResults} compact onItemSelect={handleMoreMenuSelect} />
        ) : (
          <div className="px-3 py-2 text-[13px] text-[#64748b]">No matching commands</div>
        )
      ) : moreMenuGroup ? (
        <>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMoreMenuGroup(null)}
            className="mb-0.5 flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] font-semibold text-[#0f172a] hover:bg-[#f1f5f9]"
          >
            <LuChevronRight className="h-4 w-4 rotate-180 text-[#94a3b8]" />
            {moreMenuGroup}
          </button>
          <div className="mb-1 h-px bg-[#f1f5f9]" />
          {moreMenuGroup === 'AI' ? (
            renderAIControls(closeDropdown)
          ) : (
            <DropdownList items={(topMenuItems[moreMenuGroup] ?? []).map(decorateMenuItem)} compact onItemSelect={handleMoreMenuSelect} />
          )}
        </>
      ) : (
        <>
          {[...topMenus, 'AI'].map((menu) => (
            <button
              key={menu}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setMoreMenuGroup(menu)}
              className="flex min-h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f1f5f9]"
            >
              <span className="flex w-4 shrink-0 justify-center text-[#64748b]">{moreMenuGroupIcons[menu]}</span>
              <span className="flex-1">{menu === 'AI' ? 'AI tools' : menu}</span>
              <LuChevronRight className="h-4 w-4 text-[#94a3b8]" />
            </button>
          ))}
          <div className="my-1 h-px bg-[#f1f5f9]" />
          {([
            { label: 'Version history', icon: <LuHistory className="h-4 w-4" /> },
            { label: DOWNLOAD_DOCX_LABEL, icon: <LuDownload className="h-4 w-4" /> },
            { label: DOWNLOAD_PDF_LABEL, icon: <LuDownload className="h-4 w-4" /> },
            { label: 'Print', icon: <LuPrinter className="h-4 w-4" />, shortcut: 'Ctrl+P' },
          ] as const).map((item) => (
            <button
              key={item.label}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleMoreMenuSelect({ label: item.label })}
              className="flex min-h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f1f5f9]"
            >
              <span className="flex w-4 shrink-0 justify-center text-[#64748b]">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {'shortcut' in item ? <span className="text-[12px] text-[#94a3b8]">{item.shortcut}</span> : null}
            </button>
          ))}
        </>
      )}
    </div>
  );

  return (
    <header
      ref={headerRef}
      className="relative z-[11000] bg-white"
      style={{ isolation: 'isolate' }}
    >
      <div className="@container/header flex h-[52px] items-center gap-1.5 border-b border-[#f1f5f9] px-2.5 md:h-auto md:min-h-[60px] md:gap-3 md:py-1.5 md:pl-3 md:pr-3">
        <button
          type="button"
          onClick={onMainMenuClick}
          aria-label="Menu"
          title="Menu"
          className={`${isNavCollapsed ? 'hidden md:inline-flex' : 'hidden md:inline-flex xl:hidden'} h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]`}
        >
          <LuMenu className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onDocsHomeClick}
          aria-label="All documents"
          title="All documents"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[#334155] transition-colors hover:bg-[#f1f5f9] md:hidden"
        >
          {ICON_BACK}
        </button>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-3.5">
            <span ref={titleMeasureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre text-[16px] font-semibold">
              {titleDraft || ' '}
            </span>
            <input
              ref={titleInputRef}
              value={titleDraft}
              onFocus={() => setIsTitleFocused(true)}
              onBlur={() => {
                setIsTitleFocused(false);
                flushTitleChange(titleDraft);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTitleDraft(nextValue);
                scheduleTitleChange(nextValue);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  flushTitleChange(titleDraft);
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTitleDraft(documentTitle);
                  if (titleCommitTimerRef.current) {
                    window.clearTimeout(titleCommitTimerRef.current);
                    titleCommitTimerRef.current = null;
                  }
                  event.currentTarget.blur();
                }
              }}
              aria-label="Rename document"
              disabled={!canEdit}
              title={titleDraft}
              style={{ ['--ve-title-w' as string]: titleWidth ? `${Math.max(titleWidth, 80) + 16}px` : `${Math.min(Math.max(titleDraft.length, 10), 60)}ch` }}
              className="-mx-1.5 w-[calc(100%+12px)] min-w-0 truncate rounded-[8px] border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-bold leading-[1.3] text-[#0f172a] outline-none transition-colors hover:border-[#e5e7eb] focus:border-[var(--theme-primary)] focus:bg-white disabled:hover:border-transparent md:w-[var(--ve-title-w)] md:max-w-[min(100%,560px)] md:text-[16px] md:font-semibold"
            />
            <span
              role="status"
              aria-label={documentStatusLabel}
              title={documentStatusLabel}
              className={`inline-flex shrink-0 items-center gap-1.5 text-[12px] leading-4 md:text-[13px] md:text-[#64748b] ${saveState.text === 'Saved' ? 'text-[#16a34a]' : 'text-[#64748b]'}`}
            >
              <i className={`h-[7px] w-[7px] rounded-full ${saveState.dot}`} aria-hidden="true" />
              {saveState.text}
            </span>
          </div>
          {/* File, Edit, View … as in Docs (tablet and desktop). */}
          <div className="-ml-1.5 hidden h-[26px] min-w-0 flex-wrap items-center gap-px overflow-hidden text-[13.5px] text-[#475569] md:flex">
            {[...topMenus, 'AI'].map((menu) => (
              <div
                key={menu}
                className="relative"
                onMouseEnter={() => {
                  if (openDropdown?.startsWith('menu-')) setOpenDropdown(`menu-${menu}`);
                }}
              >
                <button
                  type="button"
                  aria-expanded={openDropdown === `menu-${menu}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleDropdown(`menu-${menu}`)}
                  className={`h-[26px] whitespace-nowrap rounded-md px-[7px] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] ${openDropdown === `menu-${menu}` ? 'bg-[#f1f5f9] text-[#0f172a]' : ''}`}
                >
                  {menu}
                </button>
                {openDropdown === `menu-${menu}` ? (
                  <DropdownSurface className="left-0 top-full mt-1 min-w-[250px] p-1.5">
                    {menu === 'AI' ? (
                      renderAIControls(closeDropdown)
                    ) : (
                      <DropdownList items={(topMenuItems[menu] ?? []).map(decorateMenuItem)} compact onItemSelect={handleMoreMenuSelect} />
                    )}
                  </DropdownSurface>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Phones: undo and the options sheet. */}
        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          onClick={() => runEditorAction((currentEditor) => currentEditor.undo())}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[#334155] md:hidden"
        >
          {ICON_UNDO}
        </button>
        <button
          type="button"
          aria-label="More document options"
          title="More document options"
          onClick={() => setIsPhoneSheetOpen(true)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[#334155] md:hidden"
        >
          {ICON_DOTS}
        </button>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {articleViewAction}
          {visibleCollaborators.length ? (
            <div className="flex pl-2" aria-label={`${collaborators.length} people in this document`}>
              {visibleCollaborators.map((collaborator) => (
                <span
                  key={collaborator.sessionId}
                  className="-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white"
                  style={{ backgroundColor: collaborator.color }}
                  title={`${collaborator.displayName} (${collaborator.role})`}
                >
                  {(collaborator.displayName.trim()[0] || '?').toUpperCase()}
                </span>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onShareClick}
            title="Share"
            className="inline-flex h-9 items-center gap-[7px] rounded-[9px] border border-[#e5e7eb] bg-white px-2.5 text-[14px] font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a] @[880px]/header:px-3"
          >
            {ICON_SHARE}
            <span className="hidden @[880px]/header:inline">Share</span>
          </button>
          {onReviewClick ? (
            <button
              type="button"
              onClick={onReviewClick}
              title="Review the document with AI"
              className="inline-flex h-9 items-center gap-[7px] rounded-[9px] border border-[#e5e7eb] bg-white px-2.5 text-[14px] font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a] @[880px]/header:px-3"
            >
              {ICON_REVIEW}
              <span className="hidden @[880px]/header:inline">Review</span>
            </button>
          ) : null}
          {showUpgrade ? (
            <button
              type="button"
              onClick={handleUpgrade}
              title="Upgrade"
              className="inline-flex h-9 items-center gap-[7px] rounded-[9px] bg-[var(--theme-primary)] px-3 text-[14px] font-semibold text-white shadow-[0_6px_14px_-8px_rgba(37,99,235,.8)] transition-colors hover:bg-[var(--theme-primary-dark)]"
            >
              <LuZap className="h-4 w-4 fill-current" aria-hidden="true" />
              <span className="hidden @[640px]/header:inline">Upgrade</span>
            </button>
          ) : null}
          {onToggleAssistant && !isAssistantOpen ? (
            <HeaderIconButton label="Open the assistant panel" onClick={onToggleAssistant}>
              {ICON_PANEL}
            </HeaderIconButton>
          ) : null}
          <div className="relative">
            <HeaderIconButton label="More" onClick={() => toggleDropdown('header-more')}>
              {ICON_DOTS}
            </HeaderIconButton>
            {openDropdown === 'header-more' ? (
              <DropdownSurface className="right-0 top-full mt-2 w-[240px] p-1.5">
                {([
                  { label: 'Comments', icon: <LuMessageSquare className="h-4 w-4" />, run: () => onShowCommentsClick?.() },
                  { label: 'Download Word', command: DOWNLOAD_DOCX_LABEL, icon: <LuDownload className="h-4 w-4" /> },
                  { label: 'Download LaTeX', command: DOWNLOAD_LATEX_LABEL, icon: <LuDownload className="h-4 w-4" /> },
                  { label: 'Download PDF', command: DOWNLOAD_PDF_LABEL, icon: <LuDownload className="h-4 w-4" /> },
                  { label: 'Copy to clipboard', command: 'Copy document', icon: <LuCopy className="h-4 w-4" /> },
                  { label: 'Version history', command: 'Version history', icon: <LuHistory className="h-4 w-4" /> },
                  { label: 'Document settings', command: 'Page setup', icon: <LuSlidersHorizontal className="h-4 w-4" /> },
                ] as { label: string; command?: string; icon: React.ReactNode; run?: () => void }[]).map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      closeDropdown();
                      if (item.run) item.run();
                      else if (item.command) handleMoreMenuSelect({ label: item.command });
                    }}
                    className="flex min-h-[36px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f1f5f9]"
                  >
                    <span className="text-[#64748b]">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </DropdownSurface>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ai-editor-print-hidden relative hidden border-b border-[#f1f5f9] md:block">
        {/* One row of tools, most used first; what doesn't fit waits behind ⋮ (as in Docs). */}
        <div className="flex h-12 items-center gap-1 px-3">
          <div className="relative h-10 min-w-0 flex-1">
            <div
              ref={toolbarRowRef}
              data-testid="editor-toolbar-row"
              data-expanded={isToolbarExpanded ? 'true' : undefined}
              className={`ve-toolbar-row flex flex-wrap items-center gap-x-0.5 gap-y-1 pt-[3px] ${
                isToolbarExpanded
                  ? 'absolute -left-3 -right-3 top-0 z-[40] rounded-b-[14px] border-x border-b border-[#e5e7eb] bg-white px-3 pb-2 shadow-[0_22px_40px_-24px_rgba(15,23,42,.35)]'
                  : 'h-10'
              }`}
            >
            <div className="relative">
              <ToolbarIconButton
                label="Search menus (Alt+/)"
                active={openDropdown === 'toolbar-search'}
                onClick={() => {
                  setSearchQuery('');
                  setMoreMenuGroup(null);
                  toggleDropdown('toolbar-search');
                }}
              >
                <LuSearch className="h-4 w-4" />
              </ToolbarIconButton>
              {openDropdown === 'toolbar-search' ? (
                <DropdownSurface className="left-0 top-full mt-2 w-[300px] p-1.5">{renderMoreMenu()}</DropdownSurface>
              ) : null}
            </div>
            <ToolbarIconButton label="Undo (Ctrl+Z)" onClick={() => runEditorAction((currentEditor) => { currentEditor.undo(); })} disabled={!canEdit}>
              {ICON_UNDO}
            </ToolbarIconButton>
            <ToolbarIconButton label="Redo (Ctrl+Y)" onClick={() => runEditorAction((currentEditor) => { currentEditor.redo(); })} disabled={!canEdit}>
              {ICON_REDO}
            </ToolbarIconButton>
            <ToolbarDivider />
            <div className="relative">
              <ToolbarSelect
                label="Styles"
                value={styleValue === 'Normal text' ? 'Paragraph' : styleValue}
                isOpen={openDropdown === 'select-style'}
                onClick={() => toggleDropdown('select-style')}
                className="w-[128px]"
                disabled={!canEdit}
              />
              {openDropdown === 'select-style' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[220px]">
                  <DropdownList
                    items={styleOptions.map((option) => ({
                      label: option,
                      selected: styleValue === option,
                    }))}
                    compact
                    onItemSelect={(item) => handleStyleSelection(item.label)}
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <ToolbarDivider />
            {([
              { id: 'bold', label: 'Bold (Ctrl+B)', glyph: <span className="text-[15px] font-extrabold">B</span> },
              { id: 'italic', label: 'Italic (Ctrl+I)', glyph: <span className="font-[Georgia,serif] text-[16px] italic">I</span> },
              { id: 'underline', label: 'Underline (Ctrl+U)', glyph: <span className="text-[15px] underline underline-offset-2">U</span> },
              { id: 'strike', label: 'Strikethrough (Alt+Shift+5)', glyph: <span className="text-[15px] line-through">S</span> },
            ] as const).map((button) => (
              <ToolbarIconButton
                key={button.id}
                label={button.label}
                active={Boolean(activeStyles[button.id])}
                onClick={() => handleToggleInlineStyle(button.id)}
                disabled={!canEdit}
              >
                {button.glyph}
              </ToolbarIconButton>
            ))}
            <ToolbarDivider />
            <button
              type="button"
              title="Insert a citation (or type @ in the text)"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (onInsertCitation ? onInsertCitation() : handleOpenCitationDialog())}
              disabled={!canEdit}
              className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] px-[11px] text-[14px] font-semibold text-[#0f172a] transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="font-extrabold text-[var(--theme-primary)]">@</span>Cite
            </button>
            <ToolbarIconButton
              label="Insert equation"
              onClick={() => onInsertInlineEquation?.()}
              disabled={!canEdit || !onInsertInlineEquation}
            >
              <span className="text-[17px] leading-none">∑</span>
            </ToolbarIconButton>
            <ToolbarDivider />
            <div className="relative">
              <ToolbarSelect
                label="Font"
                value={fontValue === 'Times New Roman' ? 'Times New...' : fontValue}
                isOpen={openDropdown === 'select-font'}
                onClick={() => toggleDropdown('select-font')}
                className="min-w-[96px]"
                disabled={!canEdit}
              />
              {openDropdown === 'select-font' ? (
                <DropdownSurface className="left-0 top-full mt-2 flex w-[min(100vw-24px,300px)] flex-col overflow-hidden p-0">
                  <div className="shrink-0 border-b border-[#f1f5f9] p-1">
                    <button
                      type="button"
                      title="More fonts (opens font catalog in Google Docs)"
                      onMouseDown={(event) => event.preventDefault()}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                      onClick={() => {
                        setIsMoreFontsOpen(true);
                        setFontCatalogQuery('');
                      }}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#e5e7eb] bg-white text-[#64748b]">
                        <LuPlus className="h-4 w-4" />
                      </span>
                      <span>More fonts</span>
                    </button>
                    <div className="my-1 h-px bg-[#f1f5f9]" />
                    <div
                      className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]"
                      aria-hidden
                    >
                      Recent
                    </div>
                    {recentFonts.map((family) => (
                      <button
                        key={`recent-${family}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectFontFamily(family)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                        style={{
                          fontFamily: `"${family}", "Google Sans", Roboto, Arial, sans-serif`,
                        }}
                      >
                        <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
                          {fontValue === family ? <LuCheck className="h-4 w-4" /> : null}
                        </span>
                        <span className="min-w-0 truncate">{family}</span>
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain p-1">
                    {DOCS_FONT_CATALOG.map((item) => (
                      <div key={item.family}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => item.submenu && setFontSubmenuFamily(item.family)}
                          onClick={() => selectFontFamily(item.family)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-1 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                          style={{
                            fontFamily: `"${item.family}", "Google Sans", Roboto, Arial, sans-serif`,
                          }}
                        >
                          <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
                            {fontValue === item.family ? <LuCheck className="h-4 w-4" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.family}</span>
                          {item.submenu ? (
                            <LuChevronRight
                              className={`h-4 w-4 shrink-0 text-[#64748b] transition-transform ${
                                fontSubmenuFamily === item.family ? 'rotate-90' : ''
                              }`}
                              aria-hidden
                            />
                          ) : null}
                        </button>
                        {item.submenu && fontSubmenuFamily === item.family ? (
                          <div className="mb-1 ml-7 border-l-2 border-[#e5e7eb] py-0.5 pl-2">
                            {(item.variants ?? ['Regular']).map((variant) => (
                              <button
                                key={variant}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectFontFamily(item.family, variant)}
                                className="flex w-full rounded-md px-2 py-1.5 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[var(--theme-primary-soft)]"
                                style={{
                                  fontFamily: `"${item.family}", "Google Sans", Roboto, Arial, sans-serif`,
                                  fontWeight: getFontWeightValue(variant),
                                }}
                              >
                                {variant}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </DropdownSurface>
              ) : null}
            </div>

            <div className="flex items-center gap-0.5 rounded-md px-1">
              <ToolbarIconButton
                label="Decrease font size (Ctrl+Shift+comma)"
                onClick={() => {
                  const i = fontSizeOptions.indexOf(fontSizeValue);
                  const next = i > 0 ? fontSizeOptions[i - 1] : fontSizeOptions[0];
                  applyFontSizeValue(next);
                }}
                disabled={!canEdit}
              >
                <LuMinus className="h-4 w-4" />
              </ToolbarIconButton>
              <div className="relative">
                <ToolbarSelect
                  label="Font size"
                  value={fontSizeValue}
                  isOpen={openDropdown === 'select-font-size'}
                  onClick={() => toggleDropdown('select-font-size')}
                  className="w-[62px]"
                  disabled={!canEdit}
                />
                {openDropdown === 'select-font-size' ? (
                  <DropdownSurface className="left-0 top-full mt-2 min-w-[72px]">
                    <div className="space-y-0.5">
                      {fontSizeOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            applyFontSizeValue(option);
                            closeDropdown();
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                        >
                          <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
                            {fontSizeValue === option ? <LuCheck className="h-4 w-4" /> : null}
                          </span>
                          <span>{option}</span>
                        </button>
                      ))}
                    </div>
                  </DropdownSurface>
                ) : null}
              </div>
              <ToolbarIconButton
                label="Increase font size (Ctrl+Shift+period)"
                onClick={() => {
                  const i = fontSizeOptions.indexOf(fontSizeValue);
                  const next =
                    i >= 0 && i < fontSizeOptions.length - 1
                      ? fontSizeOptions[i + 1]
                      : fontSizeOptions[fontSizeOptions.length - 1];
                  applyFontSizeValue(next);
                }}
                disabled={!canEdit}
              >
                <LuPlus className="h-4 w-4" />
              </ToolbarIconButton>
            </div>

            <ToolbarDivider />


            <div className="relative">
              <button
                type="button"
                aria-label="Text color"
                title="Text color"
                aria-expanded={openDropdown === 'toolbar-text-color'}
                disabled={!canEdit}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleDropdown('toolbar-text-color')}
                className={`inline-flex h-7 flex-col items-center justify-center rounded-sm px-1 text-[#334155] transition-colors hover:bg-[#f1f5f9] ${
                  openDropdown === 'toolbar-text-color' ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary-dark)]' : ''
                } ${!canEdit ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
              >
                <LuBaseline className="h-[18px] w-[18px]" />
                <span
                  className="mt-[-2px] h-0.5 w-[18px] rounded-sm"
                  style={{ backgroundColor: textColorChoice }}
                />
              </button>
              {openDropdown === 'toolbar-text-color' ? (
                <DropdownSurface className="left-0 top-full mt-2 w-[360px] p-2.5">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                    Text color
                  </div>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleTextColorChange('default')}
                    className="mb-2 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded border border-[#e5e7eb] bg-[linear-gradient(135deg,#fff_44%,#dadce0_44%,#dadce0_56%,#fff_56%)]" />
                    <span>None</span>
                  </button>
                  <div className="grid grid-cols-10 gap-1.5">
                    {textColorSwatches.map((sw) => (
                      <button
                        key={sw.hex + sw.label}
                        type="button"
                        title={sw.label}
                        aria-label={sw.label}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleTextColorChange(sw.hex)}
                        className={`flex h-7 w-7 items-center justify-center rounded border border-[#e5e7eb] ${
                          textColorChoice === sw.hex ? 'ring-2 ring-[var(--theme-primary)]' : ''
                        }`}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                  </div>
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Highlight color"
                title="Highlight color"
                aria-expanded={openDropdown === 'toolbar-highlight'}
                disabled={!canEdit}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleDropdown('toolbar-highlight')}
                className={`inline-flex h-7 flex-col items-center justify-center rounded-sm px-1 text-[#334155] transition-colors hover:bg-[#f1f5f9] ${
                  openDropdown === 'toolbar-highlight' ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary-dark)]' : ''
                } ${!canEdit ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
              >
                <LuPaintBucket className="h-[18px] w-[18px]" />
                <span
                  className="mt-[-2px] h-0.5 w-[18px] rounded-sm"
                  style={{
                    backgroundColor: highlightChoice === 'transparent' ? '#e8eaed' : highlightChoice,
                  }}
                />
              </button>
              {openDropdown === 'toolbar-highlight' ? (
                <DropdownSurface className="left-0 top-full mt-2 w-[360px] p-2.5">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                    Highlight color
                  </div>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleHighlightChange('default')}
                    className="mb-2 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded border border-[#e5e7eb] bg-[linear-gradient(135deg,#fff_44%,#dadce0_44%,#dadce0_56%,#fff_56%)]" />
                    <span>None</span>
                  </button>
                  <div className="grid grid-cols-10 gap-1.5">
                    {highlightSwatches.map((sw) => (
                      <button
                        key={sw.hex + sw.label}
                        type="button"
                        title={sw.label}
                        aria-label={sw.label}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleHighlightChange(sw.hex)}
                        className={`flex h-7 w-7 items-center justify-center rounded border border-[#e5e7eb] ${
                          highlightChoice === sw.hex ? 'ring-2 ring-[var(--theme-primary)]' : ''
                        }`}
                        style={{
                          backgroundColor: sw.hex === 'transparent' ? '#fff' : sw.hex,
                          backgroundImage:
                            sw.hex === 'transparent'
                              ? 'linear-gradient(135deg, #fff 45%, #dadce0 45%, #dadce0 55%, #fff 55%)'
                              : undefined,
                        }}
                      />
                    ))}
                  </div>
                </DropdownSurface>
              ) : null}
            </div>

            {textInlineButtons.map((button) =>
              button.id === 'link' ? (
                <div key={button.id} className="relative">
                  <ToolbarIconButton
                    label={button.label}
                    active={Boolean(selectedLinkUrl) || openDropdown === 'toolbar-link-editor'}
                    onClick={handleOpenLinkEditor}
                    disabled={!canEdit}
                  >
                    {button.icon}
                  </ToolbarIconButton>
                  {openDropdown === 'toolbar-link-editor' ? (
                    <DropdownSurface className="left-0 top-full mt-2 w-[min(100vw-24px,320px)] p-3">
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                            Link
                          </label>
                          <input
                            type="url"
                            value={linkEditorUrl}
                            onChange={(event) => setLinkEditorUrl(event.target.value)}
                            placeholder="https://"
                            className="h-9 w-full rounded-lg border border-[#e5e7eb] px-3 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                            Text
                          </label>
                          <input
                            type="text"
                            value={linkEditorText}
                            onChange={(event) => setLinkEditorText(event.target.value)}
                            placeholder="Link text"
                            className="h-9 w-full rounded-lg border border-[#e5e7eb] px-3 text-[13px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={handleRemoveSelectedLink}
                            disabled={!selectedLinkUrl}
                            className="inline-flex h-9 items-center rounded-lg px-3 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            Remove
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={closeDropdown}
                              className="inline-flex h-9 items-center rounded-lg px-3 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={handleSubmitLinkEditor}
                              className="inline-flex h-9 items-center rounded-lg bg-[var(--theme-primary)] px-3 text-[12px] font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    </DropdownSurface>
                  ) : null}
                </div>
              ) : (
              <ToolbarIconButton
                key={button.id}
                label={button.label}
                  onClick={button.id === 'comment' ? onCommentClick : undefined}
                  disabled={button.id === 'comment' ? !canComment : false}
              >
                {button.icon}
              </ToolbarIconButton>
              ),
            )}

            <div className="relative">
              <ToolbarMenuButton
                label="Insert image"
                isOpen={openDropdown === 'toolbar-insert-image'}
                onClick={() => toggleDropdown('toolbar-insert-image')}
                icon={<LuImage className="h-[18px] w-[18px]" />}
                className="pl-1 pr-0.5"
                disabled={!canEdit}
              />
              {openDropdown === 'toolbar-insert-image' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[220px]">
                  <DropdownList
                    // "Camera" only where there is one to open (phones, tablets).
                    items={insertImageMenuItems.filter((item) => item.label !== 'Camera' || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches))}
                    compact
                    onItemSelect={(item) => {
                      if (item.label === 'Upload from computer') {
                        imageUploadInputRef.current?.click();
                        closeDropdown();
                        return;
                      }

                      if (item.label === 'By URL') {
                        promptForImageUrl('Enter image URL', 'https://');
                        return;
                      }

                      if (item.label === 'Camera') {
                        imageCameraInputRef.current?.click();
                        return;
                      }

                      closeDropdown();
                    }}
                  />
                </DropdownSurface>
              ) : null}
            </div>


            <div className="relative">
              <ToolbarIconButton
                label="More text formats"
                onClick={() => toggleDropdown('toolbar-more')}
                active={openDropdown === 'toolbar-more'}
                disabled={!canEdit}
              >
                <LuSuperscript className="h-4 w-4" />
              </ToolbarIconButton>
              {openDropdown === 'toolbar-more' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[240px]">
                  <div className="border-b border-[#f1f5f9] px-2 py-1.5 text-[11px] text-[#64748b]">
                    More formatting
                  </div>
                  <div className="flex flex-wrap gap-0.5 p-1.5">
                    <ToolbarIconButton
                      label="Strikethrough (Alt+Shift+5)"
                      active={Boolean(activeStyles.strike)}
                      onClick={() => handleToggleInlineStyle('strike')}
                      disabled={!canEdit}
                    >
                      <LuStrikethrough className="h-[18px] w-[18px]" />
                    </ToolbarIconButton>
                    <ToolbarIconButton
                      label="Superscript (Ctrl+period)"
                      active={activeStyles.verticalAlign === 'super'}
                      onClick={() => handleVerticalAlignToggle('super')}
                      disabled={!canEdit}
                    >
                      <LuSuperscript className="h-[18px] w-[18px]" />
                    </ToolbarIconButton>
                    <ToolbarIconButton
                      label="Subscript (Ctrl+comma)"
                      active={activeStyles.verticalAlign === 'sub'}
                      onClick={() => handleVerticalAlignToggle('sub')}
                      disabled={!canEdit}
                    >
                      <LuSubscript className="h-[18px] w-[18px]" />
                    </ToolbarIconButton>
                  </div>
                  <div className="my-1 h-px bg-[#f1f5f9]" />
                  <DropdownList
                    items={moreToolbarMenuItems}
                    compact
                    onItemSelect={(item) => {
                      if (item.label === 'Copy formatting') {
                        closeDropdown();
                        togglePaintFormat();
                        return;
                      }
                      if (item.label === 'Clear formatting') {
                        handleClearFormatting();
                        return;
                      }
                      if (item.label === 'Page break') {
                        handleInsertPageBreak();
                        return;
                      }
                      if (item.label === 'Horizontal line') {
                        handleInsertDivider();
                        return;
                      }
                      if (item.label === 'Bookmark') {
                        onBookmarkClick?.();
                        closeDropdown();
                        return;
                      }
                      if (item.label === 'Equation') {
                        insertBlockAfterSelection({ type: 'equation', props: { latex: '' } });
                        closeDropdown();
                        return;
                      }
                      if (item.label === 'Special characters') {
                        setOpenDropdown('toolbar-special-characters');
                        return;
                      }
                      closeDropdown();
                    }}
                  />
                </DropdownSurface>
              ) : null}
              {openDropdown === 'toolbar-special-characters' ? (
                <DropdownSurface className="left-0 top-full mt-2 w-[min(100vw-24px,296px)] p-2.5">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                    Special characters
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {specialCharacterItems.map((character, index) => (
                      <button
                        key={`${character}-${index}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          runEditorAction((currentEditor) => {
                            currentEditor.insertInlineContent([character]);
                          });
                          closeDropdown();
                        }}
                        className="flex h-9 items-center justify-center rounded-lg border border-[#e5e7eb] text-[18px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                      >
                        {character}
                      </button>
                    ))}
                  </div>
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <ToolbarMenuButton
                label="Align and indent"
                isOpen={openDropdown === 'select-align'}
                onClick={() => toggleDropdown('select-align')}
                icon={getAlignmentIcon(activeTextAlignment)}
                disabled={!canEdit}
              />
              {openDropdown === 'select-align' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[210px]">
                  <DropdownList
                    items={alignMenuItems.map((item) => ({
                      ...item,
                      selected: item.label.toLowerCase() === activeTextAlignment,
                    }))}
                    compact
                    onItemSelect={(item) =>
                      handleAlignmentSelection(item.label.toLowerCase() as DocsTextAlignment)
                    }
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <ToolbarMenuButton
                label="Line and paragraph spacing"
                isOpen={openDropdown === 'select-spacing'}
                onClick={() => toggleDropdown('select-spacing')}
                icon={<LuArrowDownUp className="h-[18px] w-[18px]" />}
                className="pr-1"
                disabled={!canEdit}
              />
              {openDropdown === 'select-spacing' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[240px]">
                  <DropdownList
                    items={lineSpacingMenuItems.map((item) => {
                      const paragraphProps = ((editor && getPrimarySelectedBlock(editor)?.props) || {}) as Record<string, any>;
                      const currentLineHeight = String(paragraphProps.lineSpacing || '1.15');
                      if (item.label === 'Add space before paragraph' && paragraphProps.spaceBefore) return { ...item, label: 'Remove space before paragraph' };
                      if (item.label === 'Add space after paragraph' && paragraphProps.spaceAfter) return { ...item, label: 'Remove space after paragraph' };
                      const selectedMap: Record<string, string> = {
                        Single: '1',
                        '1.15': '1.15',
                        '1.5': '1.5',
                        Double: '2',
                      };

                      return {
                        ...item,
                        selected:
                          item.label in selectedMap ? selectedMap[item.label] === currentLineHeight : false,
                      };
                    })}
                    compact
                    onItemSelect={(item) => handleLineSpacingSelection(item.label)}
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <div className={isTableSelectionActive || openDropdown === 'select-table-tools' ? 'relative' : 'hidden'}>
              <ToolbarMenuButton
                label="Table layout"
                isOpen={openDropdown === 'select-table-tools'}
                onClick={() => toggleDropdown('select-table-tools')}
                icon={<span className="px-0.5 text-[12px] font-medium">Table</span>}
                disabled={!canEdit || !isTableSelectionActive}
              />
              {openDropdown === 'select-table-tools' ? (
                <DropdownSurface className="left-0 top-full mt-2 w-[min(100vw-24px,328px)] p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-medium text-[#0f172a]">Table tools</div>
                      <div className="text-[11px] text-[#64748b]">
                        {activeTableCell
                          ? `Selected cell: row ${activeTableCell.row + 1}, column ${activeTableCell.col + 1}`
                          : 'Place the cursor inside a table cell'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      ['Insert row above', 'add-row-above'],
                      ['Insert row below', 'add-row-below'],
                      ['Insert column left', 'add-column-left'],
                      ['Insert column right', 'add-column-right'],
                      ['Remove row', 'remove-row'],
                      ['Remove column', 'remove-column'],
                    ].map(([label, action]) => (
                      <button
                        key={action}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          handleTableStructureAction(
                            action as
                              | 'add-row-above'
                              | 'add-row-below'
                              | 'remove-row'
                              | 'add-column-left'
                              | 'add-column-right'
                              | 'remove-column',
                          )
                        }
                        className="rounded-lg border border-[#e5e7eb] px-2.5 py-2 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="my-2 h-px bg-[#f1f5f9]" />

                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                        Current row fill
                      </div>
                      <div className="grid grid-cols-9 gap-1">
                        {tableFillSwatches.map((swatch) => (
                          <button
                            key={`row-${swatch.hex}`}
                            type="button"
                            title={swatch.label}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTableAxisColor('row', swatch.hex)}
                            className={`h-6 w-6 rounded border border-[#e5e7eb] ${
                              swatch.hex === 'default' ? 'bg-white text-[10px] text-[#64748b]' : ''
                            }`}
                            style={
                              swatch.hex === 'default' ? undefined : { backgroundColor: swatch.hex }
                            }
                          >
                            {swatch.hex === 'default' ? 'X' : null}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                        Current column fill
                      </div>
                      <div className="grid grid-cols-9 gap-1">
                        {tableFillSwatches.map((swatch) => (
                          <button
                            key={`column-${swatch.hex}`}
                            type="button"
                            title={swatch.label}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTableAxisColor('column', swatch.hex)}
                            className={`h-6 w-6 rounded border border-[#e5e7eb] ${
                              swatch.hex === 'default' ? 'bg-white text-[10px] text-[#64748b]' : ''
                            }`}
                            style={
                              swatch.hex === 'default' ? undefined : { backgroundColor: swatch.hex }
                            }
                          >
                            {swatch.hex === 'default' ? 'X' : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="my-2 h-px bg-[#f1f5f9]" />

                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleTableStructureAction('remove-table')}
                    className="w-full rounded-lg border border-[#f1b7b1] px-2.5 py-2 text-left text-[12px] font-medium text-[#c5221f] transition-colors hover:bg-[#fce8e6]"
                  >
                    Delete table
                  </button>
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <ToolbarSplitButton
                icon={<LuListChecks className="h-[18px] w-[18px]" />}
                label="Checklist"
                isOpen={openDropdown === 'select-checklist'}
                onButtonClick={() => handleListToggle('checkListItem')}
                onArrowClick={() => toggleDropdown('select-checklist')}
                disabled={!canEdit}
              />
              {openDropdown === 'select-checklist' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[220px]">
                  <DropdownList
                    items={checklistMenuItems.map((item) => ({
                      ...item,
                      selected:
                        activeListType === 'checkListItem' &&
                        item.label ===
                          (currentBlockId && listVariants.checklist[currentBlockId] === 'subtasks'
                            ? 'Checklist with subtasks'
                            : 'Checklist'),
                    }))}
                    compact
                    onItemSelect={(item) => handleChecklistVariantSelection(item.label)}
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <ToolbarSplitButton
                icon={<LuList className="h-[18px] w-[18px]" />}
                label="Bulleted list"
                isOpen={openDropdown === 'select-bullets'}
                onButtonClick={() => handleListToggle('bulletListItem')}
                onArrowClick={() => toggleDropdown('select-bullets')}
                disabled={!canEdit}
              />
              {openDropdown === 'select-bullets' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[220px]">
                  <DropdownList
                    items={bulletMenuItems.map((item) => ({
                      ...item,
                      selected:
                        activeListType === 'bulletListItem' &&
                        item.label ===
                          ({
                            hollow: 'Hollow bullets',
                            diamond: 'Diamond bullets',
                            standard: 'Standard bullets',
                          }[
                            (currentBlockId ? listVariants.bullet[currentBlockId] : undefined) ?? 'standard'
                          ] ?? 'Standard bullets'),
                    }))}
                    compact
                    onItemSelect={(item) => handleBulletVariantSelection(item.label)}
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <div className="relative">
              <ToolbarSplitButton
                icon={<LuListOrdered className="h-[18px] w-[18px]" />}
                label="Numbered list"
                isOpen={openDropdown === 'select-numbers'}
                onButtonClick={() => handleListToggle('numberedListItem')}
                onArrowClick={() => toggleDropdown('select-numbers')}
                disabled={!canEdit}
              />
              {openDropdown === 'select-numbers' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[220px]">
                  <DropdownList
                    items={numberedMenuItems.map((item) => ({
                      ...item,
                      selected:
                        activeListType === 'numberedListItem' &&
                        item.label ===
                          ({
                            bracket: '1) 2) 3)',
                            roman: 'I. II. III.',
                            standard: '1. 2. 3.',
                          }[
                            (currentBlockId ? listVariants.numbered[currentBlockId] : undefined) ?? 'standard'
                          ] ?? '1. 2. 3.'),
                    }))}
                    compact
                    onItemSelect={(item) => handleNumberVariantSelection(item.label)}
                  />
                </DropdownSurface>
              ) : null}
            </div>

            <ToolbarIconButton
              label="Decrease indent"
              onClick={() => runEditorAction((currentEditor) => changeIndent(currentEditor, -1))}
              disabled={!canEdit}
            >
              <LuIndentDecrease className="h-[18px] w-[18px]" />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Increase indent"
              onClick={() => runEditorAction((currentEditor) => changeIndent(currentEditor, 1))}
              disabled={!canEdit}
            >
              <LuIndentIncrease className="h-[18px] w-[18px]" />
            </ToolbarIconButton>
            <ToolbarIconButton label="Clear formatting" onClick={handleClearFormatting} disabled={!canEdit}>
              <LuRemoveFormatting className="h-[18px] w-[18px]" />
            </ToolbarIconButton>
            <ToolbarDivider />
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Editing mode"
              aria-expanded={openDropdown === 'select-mode'}
              onClick={() => toggleDropdown('select-mode')}
              title={`Mode: ${editingModeValue}`}
              className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[14px] text-[#334155] transition-colors hover:bg-[#f1f5f9] ${
                openDropdown === 'select-mode' ? 'bg-[#f1f5f9] text-[#0f172a]' : ''
              }`}
            >
              <LuPencil className="h-4 w-4 text-[#475569]" />
              <span>
                {activeRole === 'owner' || activeRole === 'editor'
                  ? editingModeValue
                  : activeRole === 'commenter'
                    ? 'Commenting'
                    : 'Viewing'}
              </span>
              <ChevronDown />
            </button>
            {openDropdown === 'select-mode' ? (
              <DropdownSurface className="left-0 top-full mt-2 min-w-[260px]">
                <div className="space-y-0.5">
                  {editingModeOptions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => {
                        onEditingModeChange?.(option.label as 'Editing' | 'Suggesting' | 'Viewing');
                        closeDropdown();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#f1f5f9]"
                    >
                      <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
                        {editingModeValue === option.label ? <LuCheck className="h-4 w-4" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-[#0f172a]">{option.label}</span>
                        {option.description ? (
                          <span className="block text-[11px] text-[#64748b]">{option.description}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </DropdownSurface>
            ) : null}
          </div>
            <ToolbarDivider />
              {utilityButtons.filter((button) => button.id !== 'undo' && button.id !== 'redo').map((button) => (
                <ToolbarIconButton
                  key={button.id}
                  label={button.label}
                  active={
                    (button.id === 'spellcheck' && spellCheckEnabled) ||
                    (button.id === 'paint-format' && paintFormatOn)
                  }
                  ariaPressed={
                    button.id === 'spellcheck'
                      ? spellCheckEnabled
                      : button.id === 'paint-format'
                        ? paintFormatOn
                        : undefined
                  }
                  onClick={() => {
                    if (button.id === 'undo') {
                      runEditorAction((currentEditor) => {
                        currentEditor.undo();
                      });
                      return;
                    }
                    if (button.id === 'redo') {
                      runEditorAction((currentEditor) => {
                        currentEditor.redo();
                      });
                      return;
                    }
                    if (button.id === 'print') {
                      onPrintClick?.();
                      return;
                    }
                    if (button.id === 'spellcheck') onSpellCheckToggle?.();
                    if (button.id === 'paint-format') togglePaintFormat();
                  }}
                  disabled={!canEdit && button.id !== 'print'}
                >
                  {button.icon}
                </ToolbarIconButton>
              ))}

            <ToolbarDivider />

            <div className="relative">
              <ToolbarSelect
                label="Zoom"
                value={zoomValue}
                isOpen={openDropdown === 'select-zoom'}
                onClick={() => toggleDropdown('select-zoom')}
                className="min-w-[68px]"
              />
              {openDropdown === 'select-zoom' ? (
                <DropdownSurface className="left-0 top-full mt-2 min-w-[170px]">
                  <div className="space-y-0.5">
                    {zoomOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onZoomChange?.(option);
                          closeDropdown();
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                      >
                        <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-primary)]">
                          {zoomValue === option ? <LuCheck className="h-4 w-4" /> : null}
                        </span>
                        <span>{option}</span>
                      </button>
                    ))}
                  </div>
                </DropdownSurface>
              ) : null}
            </div>

            </div>
          </div>
          {toolbarOverflows || isToolbarExpanded ? (
            <span ref={toolbarToggleRef}>
              <ToolbarIconButton
                label={isToolbarExpanded ? 'Fewer tools' : 'More tools'}
                active={isToolbarExpanded}
                ariaPressed={isToolbarExpanded}
                onClick={() => setIsToolbarExpanded((current) => !current)}
              >
                <LuEllipsisVertical className="h-4 w-4" />
              </ToolbarIconButton>
            </span>
          ) : null}
          <span className="mx-1 h-5 w-px shrink-0 bg-[#e5e7eb]" aria-hidden="true" />
          {autocompleteSettings && onAutocompleteSettingsChange ? (
            <div className="relative">
              <ToolbarIconButton label="Autocomplete settings" active={openDropdown === 'autocomplete-settings'} onClick={() => toggleDropdown('autocomplete-settings')}>
                <LuChevronDown className={`h-4 w-4 transition-transform ${openDropdown === 'autocomplete-settings' ? 'rotate-180' : ''}`} />
              </ToolbarIconButton>
              {openDropdown === 'autocomplete-settings' ? (
                <DropdownSurface className="right-0 top-full mt-2 w-[320px] p-0">
                  <AutocompleteSettingsPanel settings={autocompleteSettings} onChange={onAutocompleteSettingsChange} />
                </DropdownSurface>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(aiWritingSuggestionsEnabled)}
            onClick={() => onToggleAIWritingSuggestions?.()}
            disabled={!canEdit || !onToggleAIWritingSuggestions}
            title="Grey text suggests your next sentence, with citations. Tab accepts it."
            className="inline-flex shrink-0 items-center gap-2 rounded-[8px] pl-1.5 text-[13.5px] font-medium text-[#334155] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LuSparkles className="h-4 w-4 text-[var(--theme-primary)] xl:hidden" aria-hidden="true" />
            <span className="hidden xl:inline">Autocomplete</span>
            <span className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${aiWritingSuggestionsEnabled ? 'bg-[var(--theme-primary)]' : 'bg-[#cbd5e1]'}`}>
              <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.2)] transition-all ${aiWritingSuggestionsEnabled ? 'left-[19px]' : 'left-[3px]'}`} />
            </span>
          </button>
        </div>
      </div>
      {isPhoneSheetOpen && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[12500] md:hidden" role="dialog" aria-modal="true" aria-label="Document options">
              <button
                type="button"
                aria-label="Close document options"
                className="absolute inset-0 h-full w-full cursor-default bg-[rgba(15,23,42,.35)]"
                onClick={() => {
                  setIsPhoneSheetOpen(false);
                  setPhoneSheetMenu(null);
                }}
              />
              <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[24px] bg-white px-3.5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 text-[#0f172a] shadow-[0_-10px_30px_-10px_rgba(15,23,42,.3)]">
                <div className="mx-auto mb-3 mt-0.5 h-[5px] w-[42px] rounded-full bg-[#cbd5e1]" />
                {phoneSheetMenu ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPhoneSheetMenu(null)}
                      className="mb-1 flex items-center gap-2 rounded-[10px] px-2 py-2 text-[15px] font-semibold text-[#0f172a]"
                    >
                      <LuArrowLeft className="h-5 w-5 text-[#64748b]" />
                      {phoneSheetMenu}
                    </button>
                    <DropdownList
                      items={(topMenuItems[phoneSheetMenu] ?? []).filter((item) => !desktopOnlyMenuItems.has(item.label))}
                      onItemSelect={(item) => {
                        setIsPhoneSheetOpen(false);
                        setPhoneSheetMenu(null);
                        handleTopMenuItemSelect(item);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { label: 'AI Chat', icon: <LineIcon className="h-5 w-5"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z" /></LineIcon>, onClick: () => onOpenAssistant?.('chat') },
                        { label: 'Comments', icon: <LineIcon className="h-5 w-5"><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></LineIcon>, onClick: onShowCommentsClick },
                        { label: 'Library', icon: <LineIcon className="h-5 w-5"><path d="M4 19V5M8 19V5M12 19l4-14 4 14" /></LineIcon>, onClick: () => onOpenAssistant?.('library') },
                        { label: 'Papers', icon: <LineIcon className="h-5 w-5"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></LineIcon>, onClick: () => onOpenAssistant?.('papers') },
                        { label: 'Share', icon: <LineIcon className="h-5 w-5"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></LineIcon>, onClick: onShareClick },
                        { label: 'Outline', icon: <LineIcon className="h-5 w-5"><path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01" /></LineIcon>, onClick: onOutlineToggle },
                        { label: 'History', icon: <LineIcon className="h-5 w-5"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></LineIcon>, onClick: onVersionHistoryClick },
                        { label: 'Review', icon: <LuShieldCheck className="h-5 w-5" />, onClick: () => onOpenAssistant?.('review') },
                      ].map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => {
                            setIsPhoneSheetOpen(false);
                            action.onClick?.();
                          }}
                          className="flex flex-col items-center gap-1.5 rounded-[12px] px-1 py-2 text-[12px] font-medium text-[#475569] active:bg-[#f8fafc]"
                        >
                          <span className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#f1f5f9] text-[#334155]">{action.icon}</span>
                          {action.label}
                        </button>
                      ))}
                    </div>
                    <div className="my-2 h-px bg-[#f1f5f9]" />
                    {renderAIControls(() => setIsPhoneSheetOpen(false), true)}
                    <div className="my-2 h-px bg-[#f1f5f9]" />
                    {activeRole === 'owner' || activeRole === 'editor' ? (
                      <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                        <span className="text-[15px] text-[#0f172a]">Mode</span>
                        <div className="inline-flex rounded-[12px] bg-[#f1f5f9] p-1">
                          {(['Editing', 'Viewing'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={editingModeValue === mode}
                              onClick={() => onEditingModeChange?.(mode)}
                              className={`h-8 rounded-[9px] px-3 text-[13.5px] font-semibold ${editingModeValue === mode ? 'bg-white text-[#0f172a] shadow-[0_1px_3px_rgba(15,23,42,.12)]' : 'text-[#64748b]'}`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                      <span className="text-[15px] text-[#0f172a]">Citation style</span>
                      <CitationStyleSelector
                        selectedStyle={citationStyle}
                        onStyleChange={(styleId) => onCitationStyleChange?.(styleId)}
                        className="shrink-0"
                        triggerClassName="!h-9 !rounded-[10px] !border-[#e5e7eb] !px-3 !py-0 min-w-[132px]"
                        dropdownClassName="!w-[min(92vw,380px)] !max-w-[calc(100vw-16px)] !z-[12620]"
                        hideExample
                      />
                    </div>
                    <div className="my-2 h-px bg-[#f1f5f9]" />
                    {topMenus.map((menu) => (
                      <button
                        key={menu}
                        type="button"
                        onClick={() => setPhoneSheetMenu(menu)}
                        className="flex w-full items-center justify-between rounded-[10px] px-2 py-2.5 text-left text-[15px] text-[#0f172a] active:bg-[#f8fafc]"
                      >
                        {menu}
                        <LuChevronRight className="h-5 w-5 text-[#94a3b8]" />
                      </button>
                    ))}
                    {editorConfig.renderNavigation ? <button
                      type="button"
                      onClick={() => {
                        setIsPhoneSheetOpen(false);
                        onMainMenuClick?.();
                      }}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-[15px] text-[#0f172a] hover:bg-[#f1f5f9]"
                    >
                      <LuMenu className="h-5 w-5 text-[#64748b]" />
                      App menu
                    </button> : null}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      {isWordCountOpen && typeof document !== 'undefined'
        ? createPortal(
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsWordCountOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Word count" className="relative z-10 w-full max-w-[420px] rounded-[16px] border border-[#e5e7eb] bg-white p-6 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-bold text-[#0f172a]">Word count</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsWordCountOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                aria-label="Close word count"
              >
                <LuX className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3">
                <div className="text-[12px] text-[#64748b]">Words</div>
                <div className="mt-1 text-2xl font-semibold text-[#0f172a]">{wordCountStats.words}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3">
                <div className="text-[12px] text-[#64748b]">Paragraphs</div>
                <div className="mt-1 text-2xl font-semibold text-[#0f172a]">{wordCountStats.paragraphs}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3">
                <div className="text-[12px] text-[#64748b]">Characters</div>
                <div className="mt-1 text-2xl font-semibold text-[#0f172a]">{wordCountStats.characters}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3">
                <div className="text-[12px] text-[#64748b]">Characters excluding spaces</div>
                <div className="mt-1 text-2xl font-semibold text-[#0f172a]">
                  {wordCountStats.charactersNoSpaces}
                </div>
              </div>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
      {findBar && editor ? (
        <>
          <style>{FIND_CSS}</style>
          <FindReplaceBar
            key={findBar.key}
            editor={editor}
            initialQuery={findBar.query}
            replace={findBar.replace}
            canEdit={canEdit}
            onClose={() => {
              setFindBar(null);
              editor.focus();
            }}
          />
        </>
      ) : null}
      <WordPageSetupDialog
        isOpen={isPageSetupDialogOpen}
        canEdit={canEdit}
        settings={wordSettings}
        onClose={() => setIsPageSetupDialogOpen(false)}
        onSave={(next) => {
          onWordSettingsChange?.(next);
          setIsPageSetupDialogOpen(false);
        }}
      />
      {isGeminiDialogOpen ? (
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsGeminiDialogOpen(false)} />
          <div className="relative z-10 w-full max-w-[620px] rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="border-b border-[#f1f5f9] px-6 py-5">
              <h2 className="text-[18px] font-bold text-[#0f172a]">AI assistant</h2>
              <p className="mt-1 text-[13px] text-[#64748b]">
                Launch one of the existing AI tools with your current selection or document context.
              </p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Context</div>
                <div className="mt-2 max-h-[180px] overflow-y-auto whitespace-pre-wrap text-sm text-[#0f172a]">
                  {assistantContext || 'Select text in the document to send focused context into an AI tool.'}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void handleLaunchAssistantTool('/ai-writer')}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--theme-primary)] px-4 text-sm font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
                >
                  Open AI Writer
                </button>
                {/*
                <button
                  type="button"
                  onClick={() => void handleLaunchAssistantTool('/ai-detector')}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e5e7eb] px-4 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9]"
                >
                  Open AI Detector
                </button>
                <button
                  type="button"
                  onClick={() => void handleLaunchAssistantTool('/humanizer')}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e5e7eb] px-4 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9]"
                >
                  Open Humanizer
                </button>
                */}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isCitationDialogOpen ? (
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsCitationDialogOpen(false)} />
          <div className="relative z-10 w-full max-w-[620px] rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="border-b border-[#f1f5f9] px-6 py-5">
              <h2 className="text-[18px] font-bold text-[#0f172a]">Citation</h2>
              <p className="mt-1 text-[13px] text-[#64748b]">
                Insert a citation and reuse saved entries when building a bibliography.
              </p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <input
                type="text"
                value={citationLabel}
                onChange={(event) => setCitationLabel(event.target.value)}
                placeholder="Author, title, or citation label"
                className="h-11 w-full rounded-2xl border border-[#e5e7eb] px-4 text-[14px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
              />
              <input
                type="url"
                value={citationUrl}
                onChange={(event) => setCitationUrl(event.target.value)}
                placeholder="Optional source URL"
                className="h-11 w-full rounded-2xl border border-[#e5e7eb] px-4 text-[14px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
              />
              {savedCitations.length ? (
                <div className="rounded-2xl border border-[#f1f5f9] px-4 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                    Saved citations
                  </div>
                  <div className="space-y-2">
                    {savedCitations.slice(0, 5).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setCitationLabel(entry.label);
                          setCitationUrl(entry.url ?? '');
                        }}
                        className="flex w-full items-center justify-between rounded-xl bg-[#f8fafc] px-3 py-2 text-left text-sm text-[#0f172a] transition-colors hover:bg-[var(--theme-primary-tint)]"
                      >
                        <span className="truncate">{entry.label}</span>
                        <span className="ml-3 shrink-0 text-[11px] text-[#64748b]">Reuse</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCitationDialogOpen(false)}
                  className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInsertCitation}
                  className="inline-flex h-10 items-center rounded-xl bg-[var(--theme-primary)] px-4 text-sm font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
                >
                  Insert citation
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isEquationDialogOpen ? (
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsEquationDialogOpen(false)} />
          <div className="relative z-10 w-full max-w-[620px] rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="border-b border-[#f1f5f9] px-6 py-5">
              <h2 className="text-[18px] font-bold text-[#0f172a]">Insert equation</h2>
              <p className="mt-1 text-[13px] text-[#64748b]">
                Add a formula block using LaTeX-style equation text.
              </p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <textarea
                value={equationValue}
                onChange={(event) => setEquationValue(event.target.value)}
                placeholder="E = mc^2"
                className="min-h-[160px] w-full resize-none rounded-2xl border border-[#e5e7eb] px-4 py-3 font-mono text-[14px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
              />
              <div className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3 text-sm text-[#64748b]">
                The equation is inserted as a dedicated formula block using `$$ ... $$` content so it can be refined later.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEquationDialogOpen(false)}
                  className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInsertEquation}
                  className="inline-flex h-10 items-center rounded-xl bg-[var(--theme-primary)] px-4 text-sm font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
                >
                  Insert equation
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isDetailsDialogOpen && typeof document !== 'undefined'
        ? createPortal(
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsDetailsDialogOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Document details" className="relative z-10 w-full max-w-[560px] rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="border-b border-[#f1f5f9] px-6 py-5">
              <h2 className="text-[18px] font-bold text-[#0f172a]">Document details</h2>
            </div>
            <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#f1f5f9] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Title</div>
                <div className="mt-1 text-sm text-[#0f172a]">{documentTitle}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Words</div>
                <div className="mt-1 text-sm text-[#0f172a]">{wordCountStats.words.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Language</div>
                <div className="mt-1 text-sm text-[#0f172a]">{documentLanguage}</div>
              </div>
              <div className="rounded-2xl border border-[#f1f5f9] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Characters</div>
                <div className="mt-1 text-sm text-[#0f172a]">{wordCountStats.characters.toLocaleString()}</div>
              </div>
            </div>
            <div className="flex justify-end px-6 pb-6">
              <button
                type="button"
                onClick={() => setIsDetailsDialogOpen(false)}
                className="inline-flex h-10 items-center rounded-xl bg-[var(--theme-primary)] px-4 text-sm font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
      {isKeyboardShortcutsOpen && typeof document !== 'undefined'
        ? createPortal(
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div
            className="absolute inset-0"
            aria-hidden="true"
            onClick={() => setIsKeyboardShortcutsOpen(false)}
          />
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="relative z-10 w-full max-w-[520px] rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="flex items-center justify-between border-b border-[#f1f5f9] px-6 py-5">
              <div>
                <h2 className="text-[18px] font-bold text-[#0f172a]">Keyboard shortcuts</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsKeyboardShortcutsOpen(false)}
                className="inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-[var(--theme-primary)] transition-colors hover:bg-[var(--theme-primary-soft)]"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 px-6 py-5">
              {keyboardShortcutGroups.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-2xl border border-[#f1f5f9] px-4 py-3"
                >
                  <span className="text-[14px] text-[#0f172a]">{item.label}</span>
                  <kbd className="rounded-md bg-[#f1f5f9] px-2 py-1 text-[12px] font-medium text-[#334155]">
                    {item.shortcut}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
      <input
        ref={fileUploadInputRef}
        type="file"
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={importDocumentInputRef}
        type="file"
        accept=".docx,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleImportDocument}
      />
      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
      <input
        ref={imageCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraImageCapture}
      />
      {isMoreFontsOpen ? (
        <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsMoreFontsOpen(false)} />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
            <div className="border-b border-[#f1f5f9] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[18px] font-bold text-[#0f172a]">More fonts</h2>
                  <p className="mt-1 text-sm text-[#64748b]">
                    Search the full font catalog and apply a family or variant.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMoreFontsOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#64748b] transition-colors hover:bg-[#f1f5f9]"
                  aria-label="Close more fonts"
                >
                  <LuX className="h-5 w-5" />
                </button>
              </div>
              <input
                type="text"
                value={fontCatalogQuery}
                onChange={(event) => setFontCatalogQuery(event.target.value)}
                placeholder="Search fonts"
                className="mt-4 h-10 w-full rounded-2xl border border-[#e5e7eb] px-4 text-[14px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)]"
              />
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <div className="space-y-2">
                {filteredFontCatalog.map((item) => (
                  <div key={`modal-${item.family}`} className="rounded-2xl border border-[#f1f5f9] bg-[#f8fafc] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => selectFontFamily(item.family)}
                        className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-[16px] text-[#0f172a] transition-colors hover:bg-white"
                        style={{ fontFamily: `"${item.family}", "Google Sans", Roboto, Arial, sans-serif` }}
                      >
                        {item.family}
                      </button>
                      {fontValue === item.family ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]">
                          <LuCheck className="h-4 w-4" />
                        </span>
                      ) : null}
                    </div>
                    {item.variants?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.variants.map((variant) => (
                          <button
                            key={`modal-${item.family}-${variant}`}
                            type="button"
                            onClick={() => selectFontFamily(item.family, variant)}
                            className="rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] text-[#0f172a] transition-colors hover:bg-[var(--theme-primary-tint)]"
                            style={{
                              fontFamily: `"${item.family}", "Google Sans", Roboto, Arial, sans-serif`,
                              fontWeight: getFontWeightValue(variant),
                            }}
                          >
                            {variant}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {filteredFontCatalog.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white px-4 py-6 text-sm text-[#64748b]">
                    No fonts match your search.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
