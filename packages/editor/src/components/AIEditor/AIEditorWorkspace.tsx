'use client';

// Must stay first: installs built-ins BlockNote/Tiptap call on older browsers.
import '../../lib/aiEditor/browserCompat';
import { editorPath } from '../../runtime';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Block, BlockNoteEditor } from '@blocknote/core';
import {
  BlockNoteSchema,
  COLORS_DEFAULT,
  createStyleSpec,
  defaultBlockSpecs,
  defaultProps,
  defaultStyleSpecs,
  withPageBreak,
} from '@blocknote/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { MantineProvider } from '@mantine/core';
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from '@blocknote/react';
import { SuggestionMenu as SuggestionMenuExtension, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { LuFlag, LuQuote, LuSigma, LuSparkles, LuTableOfContents, LuThumbsDown, LuThumbsUp } from 'react-icons/lu';
import { BlockNoteView } from '@blocknote/mantine';
import { preprocessRichDocumentHtml } from '../../utils/googleDocsHtmlForBlockNote';
import NavigationSidebar from '../NavigationSidebar';
import { useEditorConfig } from '../../runtime';
import { useHideMobileTabBar } from '../../lib/mobileShell';
import { useHideFloatingLaunchers } from '../../lib/floatingLaunchers';
import { toast } from 'react-hot-toast';
import EditorAppNav from './EditorAppNav';
import EditorToaster from './EditorToaster';
import { AppChatSideload, AppToolDrawer } from './AppSideloads';
import { closeSideloadChat, closeSideloadDrawer, setSideloadMenu, setSideloadMentions, showSideload, useSideloads } from '../../lib/sideloads';
import { PENDING_TEMPLATE_KEY, findTemplate, templateBlocks } from '../../lib/aiEditor/templates';
import EditorStatusBar from './EditorStatusBar';
import EditorSideRail from './EditorSideRail';
import MobileEditorToolbar from './MobileEditorToolbar';
import AuthModal from '../auth/AuthModal';
import AIEditorShareDialog from './AIEditorShareDialog';
import AIEditorActivityDialog from './AIEditorActivityDialog';
import GoogleDocsHome from './GoogleDocsHome';
import GoogleDocsHeader from './GoogleDocsHeader';
import CitationTooltip, { parseBibtexToMetadata, type CitationMetadata } from '../ResearchAgent/CitationTooltip';
import { getDecodedCitationPayload } from '../../lib/citations/citationService';
import CitationInsertModal from '../ResearchAgent/CitationInsertModal';
import StartWritingModal, { type StartWritingConfig } from '../ResearchAgent/StartWritingModal';
import {
  aiEditorInlineContentSpecs,
} from './AIEditorMentions';
import GoogleDocsDocumentSurface from './GoogleDocsDocumentSurface';
import GoogleDocsPageChrome from './GoogleDocsPageChrome';
import GoogleDocsOutlineSidebar, {
  type OutlineItem,
} from './GoogleDocsOutlineSidebar';
import ArticleViewButton from '../DocumentFinalizer/ArticleViewButton';
import { useAIEditorCollaboration } from '../../hooks/useAIEditorCollaboration';
import { useAIEditorCrdt } from '../../hooks/useAIEditorCrdt';
import {
  WORD_EDITOR_CSS,
  collectFootnotes,
  footnoteInlineContentSpec,
  pageGeometry,
  suggestionDeleteStyleSpec,
  suggestionInsertStyleSpec,
  tableOfContentsBlockSpec,
  withWordProps,
  wordSettingsCss,
  type WordSettings,
} from '../../lib/aiEditor/wordSchema';
import { importWordFile, uploadEditorAsset } from '../../lib/aiEditor/wordApi';
import { PAGINATION_CSS, requestLayout, type PaginationConfig } from '../../lib/aiEditor/pagination';
import { safeView } from '../../lib/aiEditor/editorPlugins';
import { DEFAULT_EDITOR_PLUGIN_HOOKS, createEditorPlugins, type EditorPluginHooks } from '../../lib/aiEditor/editorExtension';
import AssistantPanel, { type AssistantTab } from './assistant/AssistantPanel';
import CommentsPanel from './assistant/CommentsPanel';
import ReviewPanel from './assistant/ReviewPanel';
import { TONES, readReviewMemory, writeReviewMemory, type CheckId, type CheckRun, type CommentFilter, type ReviewMemory } from './assistant/reviewChecks';
import ChatPanel, { type ChatContext, type ChatMention } from './assistant/ChatPanel';
import LibraryPanel from './assistant/LibraryPanel';
import FindPapersPanel, { paperKey, type ParagraphTarget } from './assistant/FindPapersPanel';
import AtCitationMenu from './assistant/AtCitationMenu';
import CustomCitationDialog from './assistant/CustomCitationDialog';
import VersionHistoryDialog from './assistant/VersionHistoryDialog';
import CreditsUpsell from './assistant/CreditsUpsell';
import CitationEditPopover from './assistant/CitationEditPopover';
import { AI_BLOCK_TYPES, AIEditBox, BlockAIMenu, BlockSideMenu, blockWords, useUnfreezeSideMenu, type AIEditResult, type BlockAIAction } from './assistant/BlockAITools';
import { AssistError, DEFAULT_AUTOCOMPLETE_SETTINGS, aiCommentReply, lookupPaper, peerReview, reviewBlocks, saveAIVersion, sourceQuality, type AssistSource, type AutocompleteSettings, type ChatMessage, type DocumentVersionContent, type Paper } from '../../lib/aiEditor/assistApi';
import { aiTextToInline, replaceSourceMarkersInBlocks, serializeInlineForAI, visibleText } from '../../lib/aiEditor/aiText';
import { useAutocomplete } from '../../lib/aiEditor/useAutocomplete';
import { decorateInText } from '../../lib/aiEditor/citationText';
import { editorPrompt } from '../../lib/aiEditor/editorDialogs';
import { AUTOCOMPLETE_CSS } from '../../lib/aiEditor/autocomplete';
import { EQUATION_CSS, EquationEditor, equationBlockSpec } from '../../lib/aiEditor/equationBlock';
import {
  AI_AUTHOR,
  SUGGESTION_CSS,
  collectSuggestions,
  findTextInBlock,
  replaceAsSuggestion,
  resolveSuggestions,
  type Suggestion,
} from '../../lib/aiEditor/suggestions';
import { getAuthHeader } from '../../utils/auth/api';
import { useAIEditorDocumentRegistry } from '../../hooks/useAIEditorDocumentRegistry';
import useAISuggestion, { type AISuggestion } from '../../hooks/useAISuggestion';
import { useAuth } from '../../hooks/auth/useAuth';
import { getAIEditorProvider } from '../../lib/aiEditor/getProvider';
import {
  encodeBibtexToBase64,
  formatBibliographyOnly,
  formatCitation,
  getBibtexFromBase64,
  getCitationFingerprint,
  isNumericStyle,
  peekBibliography,
} from '../../lib/citations/citationService';
import { loadCslStyle } from '../../lib/citations/cslStyles';
import { prepareStudioHtmlForEditor } from '../../lib/aiEditor/studioImport';
import { captureEditorHandoff } from '../../lib/aiEditor/importHandoff';
import moduleAnalytics from '../../utils/moduleAnalytics';
import type { AIEditorAccessRole, AIEditorCollaborator, AIEditorComment } from '../../types/ai-editor';
import type { LibraryDocumentResponse } from '../../utils/libraryApi';
import { resolveLibraryCitationBibtex } from '../../utils/libraryCitationResolver';
import { addPaperToLibrary } from '../../lib/aiEditor/references';
import { sanitizeBlocksForSchema } from '../../lib/aiEditor/sanitizeBlocks';
import { scoreTextForAI } from '../../utils/localHumanizerScore';
import { humanizeText } from '../../utils/humanizerApi';
import { getJob, postDurableJson, waitForJob } from '../../utils/jobsApi';
import { useAIToolsAccess } from '../../hooks/useAIToolsAccess';
import { flushSync } from 'react-dom';
import {
  trackAIEditorDocumentCreated,
  trackAIEditorReviewCompleted,
} from '../../utils/analytics';

function getBlockText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return (content as {
    type: string;
    text?: string;
    content?: { text: string }[];
    props?: { displayText?: string };
  }[])
    .map((item) => {
      if (item.type === 'text') {
        return item.text ?? '';
      }

      if (item.type === 'link' && Array.isArray(item.content)) {
        return item.content.map((child) => child.text).join('');
      }

      if (item.type === 'aiCitation') {
        return item.props?.displayText ?? '';
      }

      return '';
    })
    .join('')
    .trim();
}

type AIEditorCitationStorageEntry = {
  id: string;
  label: string;
  html?: string;
  url?: string;
  base64?: string;
};

type BibliographyTextContent = {
  type: 'text';
  text: string;
  styles: Record<string, string | boolean>;
};

type BibliographyLinkContent = {
  type: 'link';
  href: string;
  content: BibliographyTextContent[];
};

type BibliographyInlineContent = BibliographyTextContent | BibliographyLinkContent;

const MANAGED_BIBLIOGRAPHY_HEADING = 'References';
const MANAGED_BIBLIOGRAPHY_ALIASES = new Set(['references', 'bibliography']);

/**
 * Inserts citations at the caret where academic styles put them: after a space, and before the
 * full stop when the caret sits right after the end of a sentence ("… students (Walker, 2005).").
 */
function insertCitationsAtCaret(editor: BlockNoteEditor<any, any, any>, items: any[]) {
  const tiptap = (editor as any)._tiptapEditor;
  const selection = tiptap?.state?.selection;
  let leading = '';
  let trailing = ' ';
  if (selection?.empty) {
    const $from = selection.$from;
    const offset = $from.parentOffset;
    const before: string = $from.parent.textBetween(Math.max(0, offset - 2), offset, undefined, '\ufffc');
    const after: string = $from.parent.textBetween(offset, Math.min($from.parent.content.size, offset + 1), undefined, '\ufffc');
    if (/[.!?]$/.test(before) && !/\S/.test(after)) {
      tiptap.commands.setTextSelection(selection.from - 1);
      leading = /\s/.test(before.charAt(before.length - 2)) ? '' : ' ';
      trailing = '';
    } else if (before && !/[\s([]$/.test(before)) {
      leading = ' ';
    }
  }
  editor.insertInlineContent([...(leading ? [leading] : []), ...items, ...(trailing ? [trailing] : [])] as any);
}

function formatEditorCitation(bibtex: string, style: string, index: number) {
  return { formatted: formatCitation(bibtex, style, index), style };
}

function extractOutlineItems(editor: BlockNoteEditor<any, any, any>): OutlineItem[] {
  const items: OutlineItem[] = [];

  editor.forEachBlock((block) => {
    if (block.type === 'heading') {
      const title = getBlockText(block.content);

      if (title) {
        items.push({
          id: block.id,
          title,
          level: typeof block.props.level === 'number' ? block.props.level : 1,
        });
      }
    }

    return true;
  });

  return items;
}

function parseRequestedRole(value: string | null): AIEditorAccessRole | null {
  if (value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer') {
    return value;
  }

  return null;
}

function getEditorBlocks(editor: BlockNoteEditor<any, any, any>): Block<any, any, any>[] {
  const maybeDocument = (editor as unknown as { document?: Block<any, any, any>[] }).document;
  return Array.isArray(maybeDocument) ? maybeDocument : [];
}

function getTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.textContent?.trim()) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function createCommentHighlightRange(root: HTMLElement, selectedText: string): Range | null {
  const target = selectedText.trim();
  if (!target) {
    return null;
  }

  const textNodes = getTextNodes(root);
  if (textNodes.length === 0) {
    return null;
  }

  const fullText = textNodes.map((node) => node.textContent || '').join('');
  const startIndex = fullText.indexOf(target);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = startIndex + target.length;
  let currentIndex = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  for (const node of textNodes) {
    const nodeText = node.textContent || '';
    const nextIndex = currentIndex + nodeText.length;

    if (!startNode && startIndex >= currentIndex && startIndex < nextIndex) {
      startNode = node;
      startOffset = startIndex - currentIndex;
    }

    if (!endNode && endIndex > currentIndex && endIndex <= nextIndex) {
      endNode = node;
      endOffset = endIndex - currentIndex;
      break;
    }

    currentIndex = nextIndex;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function createOffsetHighlightRange(root: HTMLElement, startIndex: number, endIndex: number): Range | null {
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  const textNodes = getTextNodes(root);
  if (textNodes.length === 0) {
    return null;
  }

  let currentIndex = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  for (const node of textNodes) {
    const nodeText = node.textContent || '';
    const nextIndex = currentIndex + nodeText.length;

    if (!startNode && startIndex >= currentIndex && startIndex < nextIndex) {
      startNode = node;
      startOffset = startIndex - currentIndex;
    }

    if (!endNode && endIndex > currentIndex && endIndex <= nextIndex) {
      endNode = node;
      endOffset = endIndex - currentIndex;
      break;
    }

    currentIndex = nextIndex;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function getClosestBlockElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node.closest('[data-id]') as HTMLElement | null;
  }

  return node.parentElement?.closest('[data-id]') as HTMLElement | null;
}

function getRangeOffsetsWithinRoot(root: HTMLElement, range: Range): { start: number; end: number } | null {
  try {
    const startRange = document.createRange();
    startRange.selectNodeContents(root);
    startRange.setEnd(range.startContainer, range.startOffset);
    const start = startRange.toString().length;
    const selectedText = range.toString();
    return {
      start,
      end: start + selectedText.length,
    };
  } catch {
    return null;
  }
}

function getClickTextOffset(root: HTMLElement, x: number, y: number): number | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos || !root.contains(pos.offsetNode)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(pos.offsetNode, pos.offset);
    return pre.toString().length;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    if (!range || !root.contains(range.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }
  return null;
}

function getCurrentEditorBlock(editor: BlockNoteEditor<any, any, any>): Block<any, any, any> | null {
  const selectedBlock = editor.getSelection()?.blocks?.[0];
  if (selectedBlock) {
    return selectedBlock;
  }

  try {
    return editor.getTextCursorPosition().block;
  } catch {
    return getEditorBlocks(editor)[0] ?? null;
  }
}

function getDocumentPlainText(editor: BlockNoteEditor<any, any, any>): string {
  return getEditorBlocks(editor)
    .map((block) => getBlockText(block.content))
    .filter(Boolean)
    .join('\n\n');
}

function getPreviousParagraphText(
  editor: BlockNoteEditor<any, any, any>,
  currentBlockId: string | null,
): string {
  const blocks = getEditorBlocks(editor);
  const currentIndex = currentBlockId ? blocks.findIndex((block) => block.id === currentBlockId) : -1;
  const searchIndex = currentIndex === -1 ? blocks.length - 1 : currentIndex - 1;

  for (let index = searchIndex; index >= 0; index -= 1) {
    const text = getBlockText(blocks[index].content);
    if (text) {
      return text;
    }
  }

  return '';
}

function getNextParagraphText(
  editor: BlockNoteEditor<any, any, any>,
  currentBlockId: string | null,
): string {
  const blocks = getEditorBlocks(editor);
  const currentIndex = currentBlockId ? blocks.findIndex((block) => block.id === currentBlockId) : -1;
  const searchIndex = currentIndex === -1 ? 0 : currentIndex + 1;

  for (let index = searchIndex; index < blocks.length; index += 1) {
    const text = getBlockText(blocks[index].content);
    if (text) {
      return text;
    }
  }

  return '';
}

function isPlainTextInlineContentItem(
  item: unknown,
): item is {
  type: 'text';
  text: string;
  styles?: Record<string, string | boolean>;
} {
  return Boolean(
    item &&
      typeof item === 'object' &&
      (item as { type?: string }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string',
  );
}

type AIEditorReviewableTextItem = {
  type: 'text';
  text: string;
  styles?: Record<string, string | boolean>;
};

type AIEditorReviewableCitationItem = {
  type: 'aiCitation';
  props?: {
    displayText?: string;
  };
};

type AIEditorReviewableLinkItem = {
  type: 'link';
  href: string;
  content: { type: 'text'; text: string; styles?: Record<string, string | boolean> }[];
};

type AIEditorReviewableInlineItem =
  | AIEditorReviewableTextItem
  | AIEditorReviewableCitationItem
  | AIEditorReviewableLinkItem;

type AIEditorReviewSegment = {
  kind: 'text' | 'citation';
  contentIndex: number;
  reviewStart: number;
  reviewEnd: number;
  visibleStart: number;
  visibleEnd: number;
};

type AIEditorSerializedReviewBlock = {
  reviewText: string;
  visibleText: string;
  citationPlaceholders: string[];
  segments: AIEditorReviewSegment[];
};

type AIEditorSelectedReviewRange = {
  blockId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
};

function isLinkInlineContentItem(
  item: unknown,
): item is AIEditorReviewableLinkItem {
  return Boolean(
    item &&
      typeof item === 'object' &&
      (item as { type?: string }).type === 'link' &&
      Array.isArray((item as { content?: unknown }).content),
  );
}

function isReviewableInlineContentItem(item: unknown): item is AIEditorReviewableInlineItem {
  return isPlainTextInlineContentItem(item) || isAICitationInlineContent(item) || isLinkInlineContentItem(item);
}

function serializeReviewableBlockContent(content: unknown): AIEditorSerializedReviewBlock | null {
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  if (!content.every((item) => isReviewableInlineContentItem(item))) {
    return null;
  }

  const reviewParts: string[] = [];
  const visibleParts: string[] = [];
  const citationPlaceholders: string[] = [];
  const segments: AIEditorReviewSegment[] = [];
  let reviewOffset = 0;
  let visibleOffset = 0;

  content.forEach((item, contentIndex) => {
    if (isPlainTextInlineContentItem(item)) {
      const text = item.text ?? '';
      reviewParts.push(text);
      visibleParts.push(text);
      segments.push({
        kind: 'text',
        contentIndex,
        reviewStart: reviewOffset,
        reviewEnd: reviewOffset + text.length,
        visibleStart: visibleOffset,
        visibleEnd: visibleOffset + text.length,
      });
      reviewOffset += text.length;
      visibleOffset += text.length;
      return;
    }

    if (isLinkInlineContentItem(item)) {
      const text = Array.isArray(item.content)
        ? item.content.map((c) => c.text ?? '').join('')
        : '';
      reviewParts.push(text);
      visibleParts.push(text);
      segments.push({
        kind: 'text',
        contentIndex,
        reviewStart: reviewOffset,
        reviewEnd: reviewOffset + text.length,
        visibleStart: visibleOffset,
        visibleEnd: visibleOffset + text.length,
      });
      reviewOffset += text.length;
      visibleOffset += text.length;
      return;
    }

    const placeholder = `[[CITATION_${citationPlaceholders.length + 1}]]`;
    const visibleText = (item as AIEditorReviewableCitationItem).props?.displayText ?? '(Citation)';
    citationPlaceholders.push(placeholder);
    reviewParts.push(placeholder);
    visibleParts.push(visibleText);
    segments.push({
      kind: 'citation',
      contentIndex,
      reviewStart: reviewOffset,
      reviewEnd: reviewOffset + placeholder.length,
      visibleStart: visibleOffset,
      visibleEnd: visibleOffset + visibleText.length,
    });
    reviewOffset += placeholder.length;
    visibleOffset += visibleText.length;
  });

  return {
    reviewText: reviewParts.join(''),
    visibleText: visibleParts.join(''),
    citationPlaceholders,
    segments,
  };
}

function reviewOffsetToVisibleOffset(
  serialized: AIEditorSerializedReviewBlock,
  reviewOffset: number,
): number | null {
  for (const segment of serialized.segments) {
    if (segment.kind !== 'text') {
      continue;
    }

    if (reviewOffset >= segment.reviewStart && reviewOffset <= segment.reviewEnd) {
      return segment.visibleStart + (reviewOffset - segment.reviewStart);
    }
  }

  return null;
}

function issueTouchesCitationPlaceholder(
  serialized: AIEditorSerializedReviewBlock,
  startOffset: number,
  endOffset: number,
): boolean {
  return serialized.segments.some(
    (segment) =>
      segment.kind === 'citation' &&
      startOffset < segment.reviewEnd &&
      endOffset > segment.reviewStart,
  );
}

function commentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'C';
}

function commentTimeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function findReviewIssueOverlappingSelection(
  issues: AIEditorReviewIssue[],
  selectionStart: number,
  selectionEnd: number,
): AIEditorReviewIssue | null {
  let bestIssue: AIEditorReviewIssue | null = null;
  let bestOverlap = 0;

  issues.forEach((issue) => {
    const issueStart = issue.visible_start_offset ?? issue.start_offset;
    const issueEnd = issue.visible_end_offset ?? issue.end_offset;
    const overlap = Math.min(selectionEnd, issueEnd) - Math.max(selectionStart, issueStart);
    if (overlap > bestOverlap) {
      bestIssue = issue;
      bestOverlap = overlap;
    }
  });

  return bestIssue;
}

function isReviewEligibleBlock(
  block: Block<any, any, any>,
  managedBibliographyIds: Set<string>,
): boolean {
  if (managedBibliographyIds.has(block.id)) {
    return false;
  }

  if (!['paragraph', 'heading', 'numberedListItem', 'bulletListItem', 'checkListItem'].includes(block.type)) {
    return false;
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return false;
  }

  return serializeReviewableBlockContent(block.content) !== null;
}

function rewriteReviewableBlockContent(
  content: unknown,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): {
  nextContent: AIEditorReviewableInlineItem[];
  changed: boolean;
} {
  const serialized = serializeReviewableBlockContent(content);
  if (!serialized || !Array.isArray(content) || !content.every((item) => isReviewableInlineContentItem(item))) {
    return { nextContent: [], changed: false };
  }

  if (
    serialized.citationPlaceholders.some((placeholder) => replacementText.includes(placeholder)) ||
    issueTouchesCitationPlaceholder(serialized, startOffset, endOffset)
  ) {
    return { nextContent: [], changed: false };
  }

  const nextContent: AIEditorReviewableInlineItem[] = [];
  let insertedReplacement = false;
  let changed = false;

  content.forEach((item, contentIndex) => {
    if (isAICitationInlineContent(item)) {
      nextContent.push(item);
      return;
    }

    if (isLinkInlineContentItem(item)) {
      const segment = serialized.segments.find(
        (candidate) => candidate.kind === 'text' && candidate.contentIndex === contentIndex,
      );
      if (!segment || endOffset <= segment.reviewStart || startOffset >= segment.reviewEnd) {
        nextContent.push(item as unknown as AIEditorReviewableInlineItem);
        return;
      }
      const linkText = Array.isArray(item.content) ? item.content.map((c) => c.text ?? '').join('') : '';
      const localStart = Math.max(0, startOffset - segment.reviewStart);
      const localEnd = Math.min(linkText.length, endOffset - segment.reviewStart);
      const beforeText = linkText.slice(0, localStart);
      const afterText = linkText.slice(localEnd);
      changed = true;
      if (beforeText) {
        nextContent.push({
          type: 'link' as unknown as 'text',
          href: item.href,
          content: [{ type: 'text', text: beforeText }],
        } as unknown as AIEditorReviewableInlineItem);
      }
      if (!insertedReplacement) {
        if (replacementText) {
          nextContent.push({ type: 'text', text: replacementText, styles: {} });
        }
        insertedReplacement = true;
      }
      if (afterText) {
        nextContent.push({
          type: 'link' as unknown as 'text',
          href: item.href,
          content: [{ type: 'text', text: afterText }],
        } as unknown as AIEditorReviewableInlineItem);
      }
      return;
    }

    if (!isPlainTextInlineContentItem(item)) {
      return;
    }

    const segment = serialized.segments.find(
      (candidate) => candidate.kind === 'text' && candidate.contentIndex === contentIndex,
    );
    if (!segment) {
      if (item.text) {
        nextContent.push(item);
      }
      return;
    }

    const text = item.text ?? '';
    const styles = { ...(item.styles ?? {}) };

    if (endOffset <= segment.reviewStart || startOffset >= segment.reviewEnd) {
      if (text) {
        nextContent.push({ type: 'text', text, styles });
      }
      return;
    }

    changed = true;
    const localStart = Math.max(0, startOffset - segment.reviewStart);
    const localEnd = Math.min(text.length, endOffset - segment.reviewStart);
    const beforeText = text.slice(0, localStart);
    const afterText = text.slice(localEnd);

    if (beforeText) {
      nextContent.push({ type: 'text', text: beforeText, styles });
    }

    if (!insertedReplacement) {
      if (replacementText) {
        nextContent.push({ type: 'text', text: replacementText, styles });
      }
      insertedReplacement = true;
    }

    if (afterText) {
      nextContent.push({ type: 'text', text: afterText, styles });
    }
  });

  const compacted = nextContent.reduce<typeof nextContent>((accumulator, item) => {
    const previous = accumulator[accumulator.length - 1];
    if (
      previous &&
      isPlainTextInlineContentItem(previous) &&
      isPlainTextInlineContentItem(item) &&
      JSON.stringify(previous.styles ?? {}) === JSON.stringify(item.styles ?? {})
    ) {
      previous.text += item.text;
      return accumulator;
    }

    if (isAICitationInlineContent(item) || isLinkInlineContentItem(item)) {
      accumulator.push(item);
      return accumulator;
    }

    if (isPlainTextInlineContentItem(item) && item.text) {
      accumulator.push(item);
    }
    return accumulator;
  }, []);

  return { nextContent: compacted, changed };
}

function stripHtmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparableHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingMatchesImportedTitle(heading: string, title: string): boolean {
  const normalizedHeading = normalizeComparableHeading(heading);
  const normalizedTitle = normalizeComparableHeading(title);
  if (!normalizedHeading || !normalizedTitle) {
    return false;
  }

  return (
    normalizedHeading === normalizedTitle ||
    normalizedHeading.endsWith(` ${normalizedTitle}`) ||
    normalizedTitle.endsWith(` ${normalizedHeading}`)
  );
}

function centerBlockProps(props: Record<string, unknown> | undefined) {
  return {
    ...(props ?? {}),
    textAlignment: 'center',
  };
}

function normalizeImportedManuscriptBlocks(
  blocks: Block<any, any, any>[],
  title: string,
  authors: string,
): Block<any, any, any>[] {
  if (!blocks.length) {
    return blocks;
  }

  const normalized: Block<any, any, any>[] = [];
  let hasSeenMeaningfulBlock = false;
  let addedAuthorLine = false;

  for (const block of blocks) {
    const text = getBlockText(block.content);
    const isMeaningful = Boolean(text);

    if (block.type === 'heading') {
      const level = typeof block.props.level === 'number' ? block.props.level : 1;
      const isTitle =
        !hasSeenMeaningfulBlock &&
        isMeaningful &&
        (level === 1 || headingMatchesImportedTitle(text, title) || text.length >= 48);

      if (isTitle) {
        normalized.push({
          ...block,
          props: {
            ...centerBlockProps(block.props as Record<string, unknown> | undefined),
            level: 1,
          },
        } as Block<any, any, any>);

        const authorLine = authors.trim();
        if (authorLine) {
          normalized.push({
            type: 'paragraph',
            props: centerBlockProps(undefined),
            content: [{ type: 'text', text: authorLine, styles: {} }],
          } as any);
          addedAuthorLine = true;
        }
      } else {
        normalized.push({
          ...block,
          props: {
            ...(block.props ?? {}),
            level: Math.min(Math.max(level, 1), 6),
          },
        } as Block<any, any, any>);
      }
    } else if (
      !addedAuthorLine &&
      authors.trim() &&
      !hasSeenMeaningfulBlock &&
      block.type === 'paragraph' &&
      headingMatchesImportedTitle(text, title)
    ) {
      normalized.push({
        ...block,
        props: centerBlockProps(block.props as Record<string, unknown> | undefined),
      } as Block<any, any, any>);
      normalized.push({
        type: 'paragraph',
        props: centerBlockProps(undefined),
        content: [{ type: 'text', text: authors.trim(), styles: {} }],
      } as any);
      addedAuthorLine = true;
    } else {
      normalized.push(block);
    }

    if (isMeaningful) {
      hasSeenMeaningfulBlock = true;
    }
  }

  return normalized;
}

function isAICitationInlineContent(
  item: unknown,
): item is {
  type: 'aiCitation';
  props?: {
    citationId?: string;
    base64?: string;
    displayText?: string;
    bibliography?: string;
    style?: string;
    url?: string;
    mode?: string;
    locator?: string;
    prefix?: string;
    suffix?: string;
  };
} {
  return Boolean(item && typeof item === 'object' && (item as { type?: string }).type === 'aiCitation');
}

const editorViewKeys = new WeakMap<object, string>();
let editorViewKeyCount = 0;

function getEditorViewKey(editor: object): string {
  let key = editorViewKeys.get(editor);
  if (!key) {
    editorViewKeyCount += 1;
    key = `ai-editor-view-${editorViewKeyCount}`;
    editorViewKeys.set(editor, key);
  }
  return key;
}

function rewriteCitationContent(
  content: unknown,
  style: string,
  entries: Map<string, AIEditorCitationStorageEntry>,
  numbering: Map<string, number>,
): { nextContent: unknown; changed: boolean } {
  // A citation saved in this style keeps its text: formatting all of them again with the CSL
  // engine took seconds when a long document opened. Edits that change a citation clear its
  // saved style, so it is formatted again.
  const numeric = isNumericStyle(style);
  if (!Array.isArray(content)) {
    return { nextContent: content, changed: false };
  }

  let changed = false;
  const nextContent = content.map((item) => {
    if (!isAICitationInlineContent(item)) {
      return item;
    }

    const base64 = item.props?.base64 ?? '';
    const bibtex = base64 ? getBibtexFromBase64(base64) : null;
    if (!bibtex) {
      return item;
    }

    const fingerprint = getCitationFingerprint(bibtex);
    const nextIndex = numbering.get(fingerprint) ?? numbering.size + 1;
    numbering.set(fingerprint, nextIndex);
    // Citation.js throws on malformed stored BibTeX (e.g. an unbalanced brace
    // in an imported source). This runs from the editor's change listener, so
    // the throw surfaced as an uncaught error on every keystroke. A citation
    // that cannot be formatted keeps its saved text and bibliography instead.
    let citationFormat: ReturnType<typeof formatEditorCitation> | null = null;
    const saved = item.props?.style === style && item.props?.displayText && item.props?.bibliography;
    if (saved && !numeric) {
      if (!entries.has(fingerprint)) {
        entries.set(fingerprint, {
          id: item.props?.citationId || fingerprint,
          label: stripHtmlToText(item.props!.bibliography!),
          html: item.props!.bibliography,
          url: item.props?.url,
          base64,
        });
      }
      return item;
    }
    if (saved && numeric) {
      citationFormat = { formatted: { inText: `[${nextIndex}]`, bibliography: item.props!.bibliography! }, style };
    } else try {
      citationFormat = formatEditorCitation(bibtex, style, nextIndex);
    } catch {
      // citeproc's page-range shortening (Chicago) can crash on unusual page values; the
      // citation still follows the new style without them.
      try {
        citationFormat = formatEditorCitation(bibtex.replace(/^\s*pages\s*=\s*[{"].*?[}"],?\s*$/gim, ''), style, nextIndex);
      } catch (error) {
        console.warn('AI editor could not format a stored citation; keeping its saved text.', error);
      }
    }
    if (!citationFormat) {
      if (!entries.has(fingerprint)) {
        const savedBibliography = item.props?.bibliography ?? '';
        entries.set(fingerprint, {
          id: item.props?.citationId || fingerprint,
          label: stripHtmlToText(savedBibliography) || item.props?.displayText || 'Citation',
          html: savedBibliography || undefined,
          url: item.props?.url,
          base64,
        });
      }
      return item;
    }

    const {
      formatted,
      style: formattedStyle,
    } = citationFormat;
    const inText = decorateInText(formatted.inText, item.props ?? {}, bibtex);
    const nextItem = {
      ...item,
      props: {
        ...item.props,
        displayText: inText,
        bibliography: formatted.bibliography,
        style: formattedStyle,
      },
    };

    if (
      item.props?.displayText !== inText ||
      item.props?.bibliography !== formatted.bibliography ||
      item.props?.style !== formattedStyle
    ) {
      changed = true;
    }

    if (!entries.has(fingerprint)) {
      entries.set(fingerprint, {
        id: item.props?.citationId || fingerprint,
        label: stripHtmlToText(formatted.bibliography),
        html: formatted.bibliography,
        url: item.props?.url,
        base64,
      });
    }

    return nextItem;
  });

  return { nextContent, changed };
}

const BIBLIOGRAPHY_ROLE = 'bibliography';
const BIBLIOGRAPHY_ENTRY_ROLE = 'bibliography-entry';

function isManagedBibliographyHeading(block: Block<any, any, any>): boolean {
  return (
    block.type === 'heading' &&
    MANAGED_BIBLIOGRAPHY_ALIASES.has(getBlockText(block.content).trim().toLowerCase())
  );
}

function isEmptyParagraphBlock(block: Block<any, any, any>): boolean {
  return (
    block.type === 'paragraph' &&
    getBlockText(block.content).trim() === '' &&
    !(Array.isArray(block.children) && block.children.length > 0)
  );
}

type BibliographySection = {
  heading: Block<any, any, any>;
  body: Block<any, any, any>[];
  /** False for a References section the app has not claimed yet (older documents, Word files). */
  marked: boolean;
};

/**
 * The References section the citation sync maintains. A heading the app wrote carries
 * ceRole "bibliography"; without one, a trailing References/Bibliography heading followed
 * only by paragraphs is a candidate, but its entries are only replaced when they match
 * the document's citations (a typed or imported reference list is never removed).
 */
function getBibliographySection(blocks: Block<any, any, any>[]): BibliographySection | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type !== 'heading' || block.props?.ceRole !== BIBLIOGRAPHY_ROLE) continue;
    const level = Number(block.props?.level) || 1;
    const body: Block<any, any, any>[] = [];
    for (const next of blocks.slice(index + 1)) {
      if (next.type === 'heading' && (Number(next.props?.level) || 1) <= level) break;
      body.push(next);
    }
    return { heading: block, body, marked: true };
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (!isManagedBibliographyHeading(blocks[index])) continue;
    const body = blocks.slice(index + 1);
    const isManageableTail = body.every(
      (block) => block.type === 'paragraph' || block.type === 'numberedListItem' || getBlockText(block.content) === '',
    );
    return isManageableTail ? { heading: blocks[index], body, marked: false } : null;
  }
  return null;
}

/** The References heading and everything under it (kept out of AI writing and review). */
function getManagedBibliographyBlocks(blocks: Block<any, any, any>[]): Block<any, any, any>[] {
  const section = getBibliographySection(blocks);
  return section ? [section.heading, ...section.body] : [];
}

function appendBibliographyText(
  target: BibliographyInlineContent[],
  text: string,
  styles: Record<string, string | boolean>,
) {
  const normalized = text.replace(/\s+/g, ' ');
  if (!normalized.trim()) {
    if (normalized.includes(' ') && target.length > 0) {
      const last = target[target.length - 1];
      if (last.type === 'text' && !last.text.endsWith(' ')) {
        last.text += ' ';
      }
    }
    return;
  }

  const last = target[target.length - 1];
  if (last?.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(styles)) {
    last.text += normalized;
    return;
  }

  target.push({ type: 'text', text: normalized, styles: { ...styles } });
}

function trimBibliographyEdgeWhitespace(content: BibliographyInlineContent[], fromStart: boolean) {
  for (
    let index = fromStart ? 0 : content.length - 1;
    fromStart ? index < content.length : index >= 0;
    fromStart ? index += 1 : index -= 1
  ) {
    const item = content[index];
    if (!item) {
      continue;
    }

    if (item.type === 'text') {
      item.text = fromStart ? item.text.replace(/^\s+/, '') : item.text.replace(/\s+$/, '');
      if (!item.text) {
        content.splice(index, 1);
      }
      return;
    }

    trimBibliographyEdgeWhitespace(item.content, fromStart);
    if (item.content.length === 0) {
      content.splice(index, 1);
      continue;
    }
    return;
  }
}

function compactBibliographyInlineContent(content: BibliographyInlineContent[]): BibliographyInlineContent[] {
  const compacted: BibliographyInlineContent[] = [];

  for (const item of content) {
    if (item.type === 'text') {
      const nextText = item.text
        .replace(/\s+([,.;:)\]])/g, '$1')
        .replace(/([([])\s+/g, '$1');
      if (!nextText) {
        continue;
      }

      const previous = compacted[compacted.length - 1];
      if (previous?.type === 'text' && JSON.stringify(previous.styles) === JSON.stringify(item.styles)) {
        previous.text += nextText;
      } else {
        compacted.push({ ...item, text: nextText });
      }
      continue;
    }

    const nextLinkContent = compactBibliographyInlineContent(item.content)
      .filter((child): child is BibliographyTextContent => child.type === 'text' && Boolean(child.text));
    if (nextLinkContent.length > 0) {
      compacted.push({ ...item, content: nextLinkContent });
    }
  }

  trimBibliographyEdgeWhitespace(compacted, true);
  trimBibliographyEdgeWhitespace(compacted, false);
  return compacted;
}

function extractBibliographyInlineContent(
  node: Node,
  inheritedStyles: Record<string, string | boolean> = {},
): BibliographyInlineContent[] {
  const segments: BibliographyInlineContent[] = [];

  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      appendBibliographyText(segments, child.textContent ?? '', inheritedStyles);
      return;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = child as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'br') {
      appendBibliographyText(segments, ' ', inheritedStyles);
      return;
    }

    const nextStyles = { ...inheritedStyles };
    if (tagName === 'em' || tagName === 'i') {
      nextStyles.italic = true;
    }
    if (tagName === 'strong' || tagName === 'b') {
      nextStyles.bold = true;
    }
    if (tagName === 'u') {
      nextStyles.underline = true;
    }
    if (tagName === 'sup') {
      nextStyles.superscript = true;
    }
    if (tagName === 'sub') {
      nextStyles.subscript = true;
    }

    if (tagName === 'a') {
      const href = element.getAttribute('href')?.trim() ?? '';
      const linkContent = compactBibliographyInlineContent(extractBibliographyInlineContent(element, nextStyles))
        .filter((item): item is BibliographyTextContent => item.type === 'text' && Boolean(item.text));

      if (href) {
        segments.push({
          type: 'link',
          href,
          content: linkContent.length > 0 ? linkContent : [{ type: 'text', text: href, styles: nextStyles }],
        });
      } else {
        segments.push(...linkContent);
      }
      return;
    }

    segments.push(...extractBibliographyInlineContent(element, nextStyles));
    if (element.classList.contains('csl-left-margin')) {
      appendBibliographyText(segments, ' ', {});
    }
  });

  return compactBibliographyInlineContent(segments);
}

function parseBibliographyHtmlToInlineContent(html: string): BibliographyInlineContent[] {
  if (typeof DOMParser === 'undefined') {
    const fallback = stripHtmlToText(html);
    return fallback ? [{ type: 'text', text: fallback, styles: {} }] : [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement | null;
  const entryRoot = container?.querySelector('.csl-entry') ?? container;
  const segments = entryRoot ? extractBibliographyInlineContent(entryRoot) : [];

  if (segments.length > 0) {
    return segments;
  }

  const fallback = stripHtmlToText(html);
  return fallback ? [{ type: 'text', text: fallback, styles: {} }] : [];
}

function buildManagedBibliographyBlocks(
  entries: AIEditorCitationStorageEntry[],
): Block<any, any, any>[] {
  return [
    {
      type: 'heading',
      props: { level: 2, ceRole: BIBLIOGRAPHY_ROLE },
      content: [{ type: 'text', text: MANAGED_BIBLIOGRAPHY_HEADING, styles: {} }],
    } as any,
    ...entries.map(
      (entry) =>
        ({
          type: 'paragraph',
          props: { ceRole: BIBLIOGRAPHY_ENTRY_ROLE },
          content: entry.html
            ? parseBibliographyHtmlToInlineContent(entry.html)
            : [{ type: 'text', text: entry.label, styles: {} }],
        }) as any,
    ),
  ];
}

// Everything the citation sync reads or writes. When it is unchanged since the
// last completed sync there is nothing to reformat, which keeps citeproc (one
// run per citation) and the References rewrite off the per-keystroke path.
function getCitationSyncSignature(
  editor: BlockNoteEditor<any, any, any>,
  documentId: string,
  style: string,
): string {
  const parts: string[] = [documentId, style];
  editor.forEachBlock((block) => {
    if (Array.isArray(block.content)) {
      block.content.forEach((item) => {
        if (isAICitationInlineContent(item)) {
          parts.push(
            [
              item.props?.base64 ?? '',
              item.props?.displayText ?? '',
              item.props?.bibliography ?? '',
              item.props?.style ?? '',
            ].join('\u0001'),
          );
        }
      });
    }
    return true;
  });
  const section = getBibliographySection(getEditorBlocks(editor));
  if (section) {
    parts.push(
      [section.heading, ...section.body]
        .map((block) => `${block.type}:${block.props?.ceRole ?? ''}:${getBlockText(block.content)}`)
        .join('\u0002'),
    );
  }
  return parts.join('\u0000');
}

function readLocalSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be blocked by browser privacy settings.
    return null;
  }
}

function writeLocalSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Full or blocked storage must not break editing; these are local
    // conveniences (the document itself is saved to the server).
    console.warn(`AI editor could not store ${key.split(':')[0]} in this browser:`, error);
  }
}

function normalizeBibliographyText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function syncManagedBibliographySection(
  editor: BlockNoteEditor<any, any, any>,
  entries: AIEditorCitationStorageEntry[],
) {
  const blocks = getEditorBlocks(editor);
  const section = getBibliographySection(blocks);
  const [headingBlock, ...entryBlocks] = buildManagedBibliographyBlocks(entries);

  if (!section) {
    if (entries.length === 0) return;
    const referenceBlock = blocks[blocks.length - 1];
    if (referenceBlock) editor.insertBlocks([headingBlock, ...entryBlocks] as any, referenceBlock, 'after');
    else editor.replaceBlocks(blocks as any, [headingBlock, ...entryBlocks] as any);
    return;
  }
  // A section the app has not claimed is left alone until the document has citations.
  if (!section.marked && entries.length === 0) return;

  const labels = new Set(entries.map((entry) => normalizeBibliographyText(stripHtmlToText(entry.html || entry.label))));
  const isGenerated = (block: Block<any, any, any>) =>
    block.props?.ceRole === BIBLIOGRAPHY_ENTRY_ROLE ||
    (!section.marked && labels.has(normalizeBibliographyText(getBlockText(block.content))));
  const generated = section.body.filter(isGenerated);
  const usersOwn = section.body.filter((block) => !isGenerated(block) && !isEmptyParagraphBlock(block));

  const unchanged =
    section.marked &&
    generated.length === entryBlocks.length &&
    generated.every((block, index) => getBlockText(block.content) === getBlockText((entryBlocks[index] as any).content));
  if (unchanged) return;

  if (entries.length === 0) {
    // Citations were removed: drop the generated entries, and the heading too when
    // nothing the writer typed is left under it.
    const ids = generated.map((block) => block.id);
    if (usersOwn.length === 0) ids.unshift(section.heading.id);
    if (ids.length) editor.removeBlocks(ids);
    return;
  }

  // New entries take the look of the section's existing entries (e.g. a hanging indent from Word).
  const model = section.body.find((block) => block.type === 'paragraph' && ['indentLeft', 'indentFirst', 'lineSpacing', 'spaceAfter', 'spaceBefore', 'wordStyle'].some((key) => block.props?.[key]));
  const styledEntries = model
    ? entryBlocks.map((block: any) => ({
        ...block,
        props: {
          ...block.props,
          ...Object.fromEntries(['indentLeft', 'indentFirst', 'lineSpacing', 'spaceAfter', 'spaceBefore', 'wordStyle'].map((key) => [key, model.props?.[key] ?? ''])),
        },
      }))
    : entryBlocks;
  if (generated.length) editor.replaceBlocks(generated.map((block) => block.id) as any, styledEntries as any);
  else editor.insertBlocks(styledEntries as any, section.heading, 'after');
  if (!section.marked) editor.updateBlock(section.heading, { props: { ceRole: BIBLIOGRAPHY_ROLE } } as any);
}

function getCursorActionPosition(
  root: HTMLDivElement,
  editor: BlockNoteEditor<any, any, any>,
): { top: number; left: number } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const selection = window.getSelection();
  let rect: DOMRect | null = null;

  if (selection?.rangeCount) {
    const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
    if (rangeRect.width || rangeRect.height || rangeRect.top || rangeRect.left) {
      rect = rangeRect;
    }
  }

  if (!rect) {
    const block = getCurrentEditorBlock(editor);
    const blockElement = block
      ? (root.querySelector(`[data-id="${block.id}"]`) as HTMLElement | null)
      : null;
    rect = blockElement?.getBoundingClientRect() ?? null;
  }

  if (!rect) {
    return null;
  }

  const toolbarWidth = 180;
  const toolbarHeight = 30;
  // At the end of a paragraph the pill sits on the caret's own line (nothing to
  // cover there); mid-paragraph it floats above the line so the words after the caret stay readable.
  let atParagraphEnd = false;
  if (selection?.rangeCount) {
    const caret = selection.getRangeAt(0);
    const content = (caret.endContainer.nodeType === 3 ? caret.endContainer.parentElement : caret.endContainer as Element)?.closest('.bn-inline-content');
    if (content) {
      const rest = document.createRange();
      rest.setStart(caret.endContainer, caret.endOffset);
      rest.setEnd(content, content.childNodes.length);
      atParagraphEnd = !rest.toString().trim();
    }
  }
  const top = Math.min(
    Math.max(72, atParagraphEnd ? rect.top + rect.height / 2 - toolbarHeight / 2 : rect.top - toolbarHeight - 8),
    window.innerHeight - toolbarHeight - 12,
  );
  const left = Math.min(
    Math.max(12, rect.left + rect.width + 10),
    window.innerWidth - toolbarWidth - 12,
  );

  return { top, left };
}

function resolveInlineTextColor(value: string) {
  if (!value || value === defaultProps.textColor.default) {
    return '';
  }

  return value in COLORS_DEFAULT ? COLORS_DEFAULT[value].text : value;
}

function resolveInlineBackgroundColor(value: string) {
  if (!value || value === defaultProps.backgroundColor.default) {
    return '';
  }

  return value in COLORS_DEFAULT ? COLORS_DEFAULT[value].background : value;
}

const textColorStyleSpec = createStyleSpec(
  {
    type: 'textColor',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      const color = resolveInlineTextColor(value);
      if (color) {
        span.style.color = color;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      const color = resolveInlineTextColor(value);
      if (color) {
        span.style.color = color;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.color) {
        return element.style.color;
      }

      return undefined;
    },
  },
);

const backgroundColorStyleSpec = createStyleSpec(
  {
    type: 'backgroundColor',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      const color = resolveInlineBackgroundColor(value);
      if (color) {
        span.style.backgroundColor = color;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      const color = resolveInlineBackgroundColor(value);
      if (color) {
        span.style.backgroundColor = color;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.backgroundColor) {
        return element.style.backgroundColor;
      }

      return undefined;
    },
  },
);

// Mantine's global styles set the page font; keep the host's UI font (Inter in the Videmak app).
const mantineTheme = { fontFamily: 'var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif)' };

const fontFamilyStyleSpec = createStyleSpec(
  {
    type: 'fontFamily',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontFamily = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontFamily = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.fontFamily) {
        return element.style.fontFamily;
      }

      return undefined;
    },
  },
);

const fontSizeStyleSpec = createStyleSpec(
  {
    type: 'fontSize',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontSize = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontSize = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.fontSize) {
        return element.style.fontSize;
      }

      return undefined;
    },
  },
);

const fontWeightStyleSpec = createStyleSpec(
  {
    type: 'fontWeight',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontWeight = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.fontWeight = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.fontWeight) {
        return element.style.fontWeight;
      }

      return undefined;
    },
  },
);

const verticalAlignStyleSpec = createStyleSpec(
  {
    type: 'verticalAlign',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      if (value === 'super' || value === 'sub') {
        span.style.verticalAlign = value;
        span.style.fontSize = '0.75em';
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      if (value === 'super' || value === 'sub') {
        span.style.verticalAlign = value;
        span.style.fontSize = '0.75em';
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.verticalAlign === 'super' || element.style.verticalAlign === 'sub') {
        return element.style.verticalAlign;
      }

      return undefined;
    },
  },
);

const lineHeightStyleSpec = createStyleSpec(
  {
    type: 'lineHeight',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.lineHeight = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    toExternalHTML: (value) => {
      const span = document.createElement('span');
      if (value) {
        span.style.lineHeight = value;
      }

      return {
        dom: span,
        contentDOM: span,
      };
    },
    parse: (element) => {
      if (element.style.lineHeight) {
        return element.style.lineHeight;
      }

      return undefined;
    },
  },
);

function sameReviewRange(a: AIEditorSelectedReviewRange | null, b: AIEditorSelectedReviewRange | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.blockId === b.blockId && a.startOffset === b.startOffset && a.endOffset === b.endOffset && a.selectedText === b.selectedText;
}

function getZoomPercentage(value: string) {
  if (value === 'Fit') {
    return 100;
  }

  const parsed = Number.parseInt(value.replace('%', ''), 10);
  return Number.isFinite(parsed) ? parsed : 100;
}

const AI_SCORE_FLAGGED_THRESHOLD = 35;
const HIGH_AI_SCORE_THRESHOLD = 60;
const MIN_PARAGRAPH_WORDS = 12;

interface AIEditorScoredBlock {
  blockId: string;
  order: number;
  text: string;
  wordCount: number;
  isScannable: boolean;
  score: number | null;
  severity: 'low' | 'medium' | 'high' | 'pending';
  reasons: string[];
}

interface AIEditorReviewIssue {
  id: string;
  category: 'grammar' | 'clarity' | 'flow' | 'concision' | 'rewrite' | string;
  severity: 'low' | 'medium' | 'high' | string;
  title: string;
  explanation: string;
  original_text: string;
  suggested_text: string;
  block_id?: string | null;
  start_offset: number;
  end_offset: number;
  visible_start_offset?: number;
  visible_end_offset?: number;
}

interface AIEditorReviewAnchor {
  issueId: string;
  blockId: string;
  top: number;
  left: number;
  category: string;
  severity: string;
  title: string;
  explanation: string;
  original_text: string;
  suggested_text: string;
  start_offset: number;
  end_offset: number;
}

interface AIEditorReviewRequestOptions {
  blockId?: string;
  focusText?: string;
  preferredAction?: 'grammar' | 'rewrite';
}

function getSeverity(score: number | null): AIEditorScoredBlock['severity'] {
  if (score === null) return 'pending';
  if (score >= HIGH_AI_SCORE_THRESHOLD) return 'high';
  if (score >= AI_SCORE_FLAGGED_THRESHOLD) return 'medium';
  return 'low';
}

function collectScoredBlocks(editor: BlockNoteEditor<any, any, any>): AIEditorScoredBlock[] {
  const blocks = getEditorBlocks(editor);
  const scored: AIEditorScoredBlock[] = [];
  let order = 0;

  // The reference list is not prose: scoring it only produces false flags.
  const referenceIds = new Set(getManagedBibliographyBlocks(blocks).map((block) => block.id));
  for (const block of blocks) {
    if (block.type === 'heading' || referenceIds.has(block.id)) continue;
    const text = getBlockText(block.content);
    if (!text) continue;

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const isScannable = wordCount >= MIN_PARAGRAPH_WORDS;

    if (isScannable) {
      const result = scoreTextForAI(text);
      scored.push({
        blockId: block.id,
        order,
        text,
        wordCount,
        isScannable: true,
        score: result.score,
        severity: getSeverity(result.score),
        reasons: result.reasons,
      });
    } else {
      scored.push({
        blockId: block.id,
        order,
        text,
        wordCount,
        isScannable: false,
        score: null,
        severity: 'pending',
        reasons: [],
      });
    }
    order += 1;
  }

  return scored;
}

function computeEditorHumanizerScore(editor: BlockNoteEditor<any, any, any>): {
  humanScore: number | null;
  flaggedCount: number;
} {
  const blocks = getEditorBlocks(editor);
  let totalWords = 0;
  let weightedScore = 0;
  let flagged = 0;

  for (const block of blocks) {
    if (block.type === 'heading') continue;
    const text = getBlockText(block.content);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < MIN_PARAGRAPH_WORDS) continue;

    const result = scoreTextForAI(text);
    totalWords += words;
    weightedScore += result.score * words;
    if (result.score >= AI_SCORE_FLAGGED_THRESHOLD) {
      flagged += 1;
    }
  }

  if (totalWords === 0) {
    return { humanScore: null, flaggedCount: 0 };
  }

  const aiScore = Math.round(weightedScore / totalWords);
  return {
    humanScore: Math.max(0, 100 - aiScore),
    flaggedCount: flagged,
  };
}

const STARRED_DOCUMENTS_STORAGE_KEY = 'ai-editor-starred-documents';
const AI_EDITOR_CITATION_STYLE_STORAGE_KEY = 'ai-editor-citation-style';
const AI_EDITOR_SUGGESTIONS_STORAGE_KEY = 'ai-editor-ai-suggestions';
const AI_EDITOR_WRITING_SUGGESTIONS_STORAGE_KEY = 'ai-editor-writing-suggestions';
const AI_EDITOR_REVIEW_SUGGESTIONS_STORAGE_KEY = 'ai-editor-review-suggestions';
const AI_EDITOR_REVIEW_JOB_STORAGE_PREFIX = 'ai-editor-review-job';

type RememberedAIEditorReview = {
  jobId: string;
  blockId: string;
  text: string;
};

function aiEditorReviewJobStorageKey(documentId: string): string {
  return `${AI_EDITOR_REVIEW_JOB_STORAGE_PREFIX}:${documentId}`;
}


function loadStarredDocumentIds() {
  if (typeof window === 'undefined') {
    return new Set<string>();
  }

  try {
    const raw = window.localStorage.getItem(STARRED_DOCUMENTS_STORAGE_KEY);
    if (!raw) {
      return new Set<string>();
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>();
  } catch (error) {
    console.error('Failed to load ai-editor starred documents:', error);
    return new Set<string>();
  }
}

function persistStarredDocumentIds(starredIds: Set<string>) {
  if (typeof window === 'undefined') {
    return;
  }

  writeLocalSetting(STARRED_DOCUMENTS_STORAGE_KEY, JSON.stringify(Array.from(starredIds)));
}

function getActiveCursorBlockId(
  editor: BlockNoteEditor<any, any, any>,
  collaborator: AIEditorCollaborator,
) {
  if (collaborator.isCurrentUser) {
    const selectedBlock = editor.getSelection()?.blocks?.[0];
    if (selectedBlock?.id) {
      return selectedBlock.id;
    }

    try {
      return editor.getTextCursorPosition().block.id;
    } catch {
      return null;
    }
  }

  return collaborator.cursor?.blockId ?? null;
}

/** The position of the inline node (atom) whose DOM contains `element`. */
function findInlineNodePos(view: { posAtDOM: (node: Node, offset: number) => number; state: { doc: { nodeAt: (pos: number) => any; content: { size: number } } } }, element: Element, typeName: string): number | null {
  try {
    const around = view.posAtDOM(element, 0);
    for (const pos of [around - 1, around, around - 2, around + 1]) {
      if (pos >= 0 && pos < view.state.doc.content.size && view.state.doc.nodeAt(pos)?.type.name === typeName) return pos;
    }
  } catch {
    /* not in the document */
  }
  return null;
}

export default function AIEditorWorkspace() {
  const provider = getAIEditorProvider();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { canUseHumanizer, humanizer, isLoading: isAIToolsAccessLoading } = useAIToolsAccess();
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [bookmarkItems, setBookmarkItems] = useState<OutlineItem[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  // The outline opens from the small button at the top left of the page (closed by default).
  const [isOutlinePanelVisible, setIsOutlinePanelVisible] = useState(false);
  // An open document gets the whole width: the app menu opens over it from the header's menu button.
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  // Documents live in the user's account: signing in comes before creating one.
  const [authPrompt, setAuthPrompt] = useState<'login' | 'signup' | null>(null);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  // AI Chat / Comments / Library / Find papers share one panel beside the document.
  const [assistantTab, setAssistantTab] = useState<AssistantTab | null>(null);
  const isCommentsDialogOpen = assistantTab === 'comments';
  const setIsCommentsDialogOpen = useCallback(
    (open: boolean) => setAssistantTab((current) => (open ? 'comments' : current === 'comments' ? null : current)),
    [],
  );
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);
  const [chatMentions, setChatMentions] = useState<ChatMention[]>([]);
  const [papersParagraph, setPapersParagraph] = useState<ParagraphTarget | null>(null);
  const [savedPaperKeys, setSavedPaperKeys] = useState<Set<string>>(() => new Set());
  const [reviewRun, setReviewRun] = useState<{ running: boolean; error: string | null; outOfCredits: boolean; lastAdded: number | null }>({
    running: false,
    error: null,
    outOfCredits: false,
    lastAdded: null,
  });
  const [blockAI, setBlockAI] = useState<{ blockId: string; anchor: DOMRect; mode: 'menu' | 'edit' } | null>(null);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [mathEditor, setMathEditor] = useState<{ anchor: DOMRect; latex: string; pos: number | null } | null>(null);
  const [autocompleteOutOfCredits, setAutocompleteOutOfCredits] = useState(false);
  const [isCustomCitationOpen, setIsCustomCitationOpen] = useState(false);
  const [citationEditor, setCitationEditor] = useState<{ anchor: DOMRect; pos: number; title: string; attrs: Record<string, any> } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [reviewIssuesByBlockId, setReviewIssuesByBlockId] = useState<Record<string, AIEditorReviewIssue[]>>({});
  // Cached results are read by the scheduler, not a scheduling dependency.
  // Depending on this state recreated the scheduler whenever it cleared an
  // empty result, feeding the effect below back into itself (and BlockNote).
  const reviewIssuesRef = useRef(reviewIssuesByBlockId);
  reviewIssuesRef.current = reviewIssuesByBlockId;
  const [activeReviewIssueId, setActiveReviewIssueId] = useState<string | null>(null);
  const [reviewAnchors, setReviewAnchors] = useState<AIEditorReviewAnchor[]>([]);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selectedReviewRange, setSelectedReviewRange] = useState<AIEditorSelectedReviewRange | null>(null);
  const [reviewContextMenu, setReviewContextMenu] = useState<{
    position: { top: number; left: number };
    selection: AIEditorSelectedReviewRange;
  } | null>(null);
  const [selectionBubble, setSelectionBubble] = useState<{
    top: number;
    right: number;
    blockId: string;
    selectedText: string;
  } | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<'Editing' | 'Suggesting' | 'Viewing'>('Editing');
  const [commentDraftContext, setCommentDraftContext] = useState<{
    selectedText?: string;
    blockId?: string | null;
  }>({});
  const [commentAnchors, setCommentAnchors] = useState<
    Array<{
      blockId: string;
      count: number;
      top: number;
      commentId: string;
      actorDisplayName: string;
      actorSessionId: string;
      text: string;
      selectedText?: string;
      createdAt: number;
      status: string;
      replies: Array<{ id: string; actorDisplayName: string; text: string; createdAt: number }>;
    }>
  >([]);
  const [expandedCommentBlockId, setExpandedCommentBlockId] = useState<string | null>(null);
  const [inlineCommentReplyDrafts, setInlineCommentReplyDrafts] = useState<Record<string, string>>({});
  // On by default, as in Docs and Word (the browser underlines misspellings).
  const [isSpellcheckEnabled, setIsSpellcheckEnabled] = useState(true);
  const [isDocumentStarred, setIsDocumentStarred] = useState(false);
  const [documentZoom, setDocumentZoom] = useState('Fit');
  const [documentPageWidth, setDocumentPageWidth] = useState(816);
  const [citationStyle, setCitationStyle] = useState('apa');
  const [humanScore, setHumanScore] = useState<number | null>(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const humanizerTimerRef = useRef<number | null>(null);
  const [isParagraphReviewOpen, setIsParagraphReviewOpen] = useState(false);
  const [scoredBlocks, setScoredBlocks] = useState<AIEditorScoredBlock[]>([]);
  const [humanizingBlockId, setHumanizingBlockId] = useState<string | null>(null);
  const [humanizeError, setHumanizeError] = useState<string | null>(null);
  const [areAIWritingSuggestionsEnabled, setAreAIWritingSuggestionsEnabled] = useState(true);
  const [areAIReviewSuggestionsEnabled, setAreAIReviewSuggestionsEnabled] = useState(true);
  const [isStartWritingDialogOpen, setIsStartWritingDialogOpen] = useState(false);
  const [isCitationPickerOpen, setIsCitationPickerOpen] = useState(false);
  const [isInsertingCitation, setIsInsertingCitation] = useState(false);
  const [isStartWritingFlow, setIsStartWritingFlow] = useState(false);
  const [activeAISuggestion, setActiveAISuggestion] = useState<AISuggestion | null>(null);
  const suggestionCardRef = useRef<HTMLDivElement | null>(null);
  const [suggestionAnchor, setSuggestionAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [pendingGhostBlockIds, setPendingGhostBlockIds] = useState<string[]>([]);
  const [cursorActionBar, setCursorActionBar] = useState<{
    visible: boolean;
    loading: boolean;
    position: { top: number; left: number };
  }>({
    visible: false,
    loading: false,
    position: { top: 0, left: 0 },
  });
  const [ghostActionBarPosition, setGhostActionBarPosition] = useState<{ top: number; left: number } | null>(null);
  const lastCursorBlockIdRef = useRef<string | null>(null);
  const reviewDebounceTimerRef = useRef<number | null>(null);
  const reviewAbortControllerRef = useRef<AbortController | null>(null);
  const reviewRecoveryInFlightRef = useRef(false);
  // After a credit refusal, automatic reviews stop until credits change: one
  // user's editor queued 8 refused reviews in a minute. Asking explicitly still works.
  const reviewPausedForCreditsRef = useRef(false);
  useEffect(() => {
    const resume = () => { reviewPausedForCreditsRef.current = false; };
    window.addEventListener('credits-updated', resume);
    return () => window.removeEventListener('credits-updated', resume);
  }, []);
  const lastReviewedBlockTextRef = useRef<Map<string, string>>(new Map());
  const seededCrdtDocumentIdsRef = useRef<Set<string>>(new Set());
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const documentScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [documentViewWidth, setDocumentViewWidth] = useState(0);
  const [documentScrollContainer, setDocumentScrollContainer] = useState<HTMLDivElement | null>(null);
  const attachDocumentScrollContainer = useCallback((element: HTMLDivElement | null) => {
    documentScrollContainerRef.current = element;
    setDocumentScrollContainer(element);
  }, []);
  useEffect(() => {
    if (!documentScrollContainer) return;
    const update = () => setDocumentViewWidth(documentScrollContainer.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(documentScrollContainer);
    return () => observer.disconnect();
  }, [documentScrollContainer]);
  const aiSuggestionAnchorBlockIdRef = useRef<string | null>(null);
  const isSyncingCitationsRef = useRef(false);
  const lastCitationSyncSignatureRef = useRef<string | null>(null);
  const pendingBibliographyRef = useRef(false);
  // The References list a document was saved with, trusted while its sources and style stay
  // the same (set on the first sync that sees citations; '' when it has to be rebuilt).
  const trustedReferencesRef = useRef<string | null>(null);
  const syncCitationStorageFromEditorRef = useRef<((style: string, options?: { force?: boolean; now?: boolean }) => void) | null>(null);

  const documentId = searchParams.get('doc');
  const invitedEmailParam = searchParams.get('invitedEmail');
  const requestedRole = parseRequestedRole(searchParams.get('access'));
  const collaboration = useAIEditorCollaboration(documentId, requestedRole, user?.email ?? null);
  const {
    session,
    collaborators,
    connectionLabel,
    documentSnapshot,
    effectiveRole,
    members,
    bookmarks,
    comments,
    activity,
    addMember,
    addBookmark,
    addComment,
    addCommentReply,
    removeMember,
    deleteComment,
    resolveComment,
    updateComment,
    addAIReviewComments,
    addAIReply,
    setCommentFeedback,
    updateSessionDisplayName,
    updateMemberRole,
    updateBlocks,
    flushBlocks,
    updateCursor,
    updateShareSettings,
    updateTitle,
  } = collaboration;
  const { documents: recentDocuments, sharedDocuments, createDocument, deleteDocument, renameDocument } = useAIEditorDocumentRegistry(
    documentSnapshot,
    session?.sessionId ?? null,
    user?.email ?? null,
  );
  // Realtime editing needs an account. Signed out, a document link only shows
  // the sign-in gate below, yet the socket opened anyway and the server refused
  // it 6 times ("Document not found"). So connect only once the session check
  // has found a signed-in visitor. A session that ends later keeps the open
  // provider, so edits it queued while offline are still sent after signing in again.
  const [realtimeDocumentId, setRealtimeDocumentId] = useState<string | null>(null);
  const isSignedIn = !authLoading && isAuthenticated;
  useEffect(() => {
    if (isSignedIn) setRealtimeDocumentId(documentId);
  }, [documentId, isSignedIn]);
  const crdtCollaboration = useAIEditorCrdt(
    realtimeDocumentId === documentId ? documentId : null,
    session,
    requestedRole,
    documentSnapshot?.blocks ?? [],
  );

  const acknowledgedConnectionLabel = crdtCollaboration.pendingUpdateCount > 0
    ? crdtCollaboration.status === 'connected'
      ? 'Saving to server...'
      : 'Reconnecting — changes queued safely'
    : crdtCollaboration.status === 'connected'
      ? 'Saved to server'
      : crdtCollaboration.status === 'error'
        ? 'Realtime save unavailable'
        : documentSnapshot
          ? 'Connecting to saved document...'
          : connectionLabel;

  const documentTitle = documentSnapshot?.title ?? 'Untitled document';
  // Word page setup and styles: the saved value, or the one just chosen while it saves.
  const [wordSettingsDraft, setWordSettingsDraft] = useState<{ documentId: string; value: WordSettings } | null>(null);
  const wordSettings: WordSettings | null = (wordSettingsDraft && wordSettingsDraft.documentId === documentSnapshot?.id
    ? wordSettingsDraft.value
    : (documentSnapshot?.wordSettings as WordSettings | null | undefined)) ?? null;
  const wordPage = useMemo(() => (wordSettings?.page ? pageGeometry(wordSettings) : null), [wordSettings]);
  // Print layout (pages with headers, footers and footnotes), as in Docs and Word. Off by
  // default: the text sits on a white canvas (the mockups); View › Print layout turns it on.
  const [isPageView, setIsPageView] = useState(() => {
    try {
      return window.localStorage.getItem('ce-editor-page-view') === '1';
    } catch {
      return false;
    }
  });
  const [layoutPageCount, setLayoutPageCount] = useState(1);
  const togglePageView = useCallback(() => {
    setIsPageView((current) => {
      try {
        window.localStorage.setItem('ce-editor-page-view', current ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !current;
    });
  }, []);
  const handleWordSettingsChange = useCallback((next: WordSettings) => {
    if (!documentSnapshot?.id) return;
    const documentIdForSave = documentSnapshot.id;
    setWordSettingsDraft({ documentId: documentIdForSave, value: next });
    void fetch(`/api/ai-editor/documents/${documentIdForSave}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ word_settings: next }),
    }).then((response) => {
      if (!response.ok) throw new Error('save failed');
    }).catch(() => toast.error('The page setup could not be saved. Please try again.'));
  }, [documentSnapshot?.id]);
  const canEdit = effectiveRole === 'owner' || effectiveRole === 'editor';
  const canComment = canEdit || effectiveRole === 'commenter';
  // Suggesting is editing too: changes become suggestions to accept or reject.
  const isWritingEnabled = canEdit && (surfaceMode === 'Editing' || surfaceMode === 'Suggesting');
  const isSuggesting = canEdit && surfaceMode === 'Suggesting';
  const invitedMember =
    documentSnapshot?.members.find(
      (member) => member.email.toLowerCase() === (user?.email ?? '').toLowerCase(),
    ) ?? null;
  const requiresAccountForInvite = !authLoading && !isAuthenticated && documentSnapshot?.members.length;
  const commentMentionableUsers = useMemo(() => {
    const seen = new Set<string>();
    const nextUsers: Array<{ id: string; displayName: string; email?: string | null }> = [];

    members.forEach((member) => {
      const displayName = member.displayName?.trim();
      if (!displayName) {
        return;
      }

      const dedupeKey = `${displayName.toLowerCase()}|${member.email?.toLowerCase() || ''}`;
      if (seen.has(dedupeKey)) {
        return;
      }

      seen.add(dedupeKey);
      nextUsers.push({
        id: `member-${member.id}`,
        displayName,
        email: member.email,
      });
    });

    collaborators.forEach((collaborator) => {
      const displayName = collaborator.displayName?.trim();
      if (!displayName) {
        return;
      }

      const dedupeKey = `${displayName.toLowerCase()}|`;
      if (seen.has(dedupeKey)) {
        return;
      }

      seen.add(dedupeKey);
      nextUsers.push({
        id: `collaborator-${collaborator.sessionId}`,
        displayName,
        email: null,
      });
    });

    return nextUsers;
  }, [collaborators, members]);

  const blockNoteSchema = useMemo(
    () =>
      withPageBreak(
        BlockNoteSchema.create({
          // Word paragraph formatting on text blocks, plus the table of contents block.
          blockSpecs: {
            ...defaultBlockSpecs,
            paragraph: withWordProps(defaultBlockSpecs.paragraph),
            heading: withWordProps(defaultBlockSpecs.heading),
            quote: withWordProps(defaultBlockSpecs.quote),
            bulletListItem: withWordProps(defaultBlockSpecs.bulletListItem),
            numberedListItem: withWordProps(defaultBlockSpecs.numberedListItem),
            checkListItem: withWordProps(defaultBlockSpecs.checkListItem),
            tableOfContents: tableOfContentsBlockSpec(),
            equation: equationBlockSpec(),
          },
          inlineContentSpecs: { ...aiEditorInlineContentSpecs, footnote: footnoteInlineContentSpec },
          styleSpecs: {
            suggestionInsert: suggestionInsertStyleSpec,
            suggestionDelete: suggestionDeleteStyleSpec,
            ...defaultStyleSpecs,
            textColor: textColorStyleSpec,
            backgroundColor: backgroundColorStyleSpec,
            fontFamily: fontFamilyStyleSpec,
            fontSize: fontSizeStyleSpec,
            fontWeight: fontWeightStyleSpec,
            verticalAlign: verticalAlignStyleSpec,
            lineHeight: lineHeightStyleSpec,
          },
        }),
      ),
    [],
  );
  // What the editor opens: the stored blocks reduced to this schema, so one unknown style or
  // block never stops a document from opening.
  const documentBlocks = useMemo(
    () => sanitizeBlocksForSchema(documentSnapshot?.blocks, blockNoteSchema as any),
    [blockNoteSchema, documentSnapshot?.blocks],
  );
  const isUsingCrdt = Boolean(crdtCollaboration.collaboration);
  const editorInstanceKey = `${documentSnapshot?.id ?? 'pending'}:${isUsingCrdt ? 'crdt' : 'fallback'}:${
    crdtCollaboration.shouldSeedInitialContent ? 'seed' : 'plain'
  }`;
  const shareLink = useMemo(() => {
    if (!documentSnapshot || typeof window === 'undefined') {
      return '';
    }

    const url = new URL(`${window.location.origin}${editorPath()}`);
    url.searchParams.set('doc', documentSnapshot.id);
    url.searchParams.set('access', documentSnapshot.share.defaultAccessRole);
    return url.toString();
  }, [documentSnapshot]);
  const activeEditingCollaborators = useMemo(
    () =>
      collaborators.filter(
        (collaborator) =>
          !collaborator.isCurrentUser &&
          collaborator.cursor?.blockId &&
          Date.now() - (collaborator.cursor?.updatedAt ?? 0) < 15000,
      ),
    [collaborators],
  );
  const activeReviewIssue = useMemo(
    () =>
      Object.values(reviewIssuesByBlockId)
        .flat()
        .find((issue) => issue.id === activeReviewIssueId) ?? null,
    [activeReviewIssueId, reviewIssuesByBlockId],
  );
  const resolveSelectedReviewRange = useCallback((): AIEditorSelectedReviewRange | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const root = editorSurfaceRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return null;
    }

    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      return null;
    }

    const startBlock = getClosestBlockElement(range.startContainer);
    const endBlock = getClosestBlockElement(range.endContainer);
    if (!startBlock || !endBlock || startBlock !== endBlock) {
      return null;
    }

    const blockId = startBlock.getAttribute('data-id');
    if (!blockId) {
      return null;
    }

    const offsets = getRangeOffsetsWithinRoot(startBlock, range);
    if (!offsets || offsets.end <= offsets.start) {
      return null;
    }

    return {
      blockId,
      selectedText,
      startOffset: offsets.start,
      endOffset: offsets.end,
    };
  }, []);

  const aiSuggestion = useAISuggestion({
    documentId,
    initialAutoSuggest: true,
    onSuggestionReady: useCallback((suggestion: AISuggestion) => {
      setActiveAISuggestion(suggestion);
      setCursorActionBar((current) => ({
        ...current,
        visible: false,
        loading: false,
      }));
    }, []),
    onAccept: useCallback(() => {
      setActiveAISuggestion(null);
    }, []),
    onReject: useCallback(() => {
      setActiveAISuggestion(null);
    }, []),
    onStop: useCallback(() => {
      setActiveAISuggestion(null);
      setIsStartWritingFlow(false);
      setCursorActionBar((current) => ({
        ...current,
        visible: false,
        loading: false,
      }));
    }, []),
  });

  useEffect(() => {
    if (!aiSuggestion.isActive) return;
    setIsStartWritingFlow(aiSuggestion.flowMode === 'start');
    aiSuggestionAnchorBlockIdRef.current = aiSuggestion.targetBlockId;
  }, [aiSuggestion.flowMode, aiSuggestion.isActive, aiSuggestion.targetBlockId]);

  const pasteHandler = useCallback(
    ({
      event,
      editor: bnEditor,
      defaultPasteHandler,
    }: {
      event: ClipboardEvent;
      editor: BlockNoteEditor<any, any, any>;
      defaultPasteHandler: (opts?: {
        prioritizeMarkdownOverHTML?: boolean;
        plainTextAsMarkdown?: boolean;
      }) => boolean | undefined;
    }) => {
      const cd = event.clipboardData;
      if (!cd) {
        return defaultPasteHandler({
          prioritizeMarkdownOverHTML: false,
          plainTextAsMarkdown: false,
        });
      }

      const types = Array.from(cd.types);
      if (types.includes('vscode-editor-data') || types.includes('blocknote/html')) {
        return defaultPasteHandler({
          prioritizeMarkdownOverHTML: false,
          plainTextAsMarkdown: false,
        });
      }

      if (types.includes('Files')) {
        for (let i = 0; i < cd.items.length; i++) {
          const item = cd.items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            return defaultPasteHandler({
              prioritizeMarkdownOverHTML: false,
              plainTextAsMarkdown: false,
            });
          }
        }
      }

      if (types.includes('text/html')) {
        const html = cd.getData('text/html');
        if (html && html.replace(/\s/g, '').length > 20) {
          bnEditor.pasteHTML(preprocessRichDocumentHtml(html), false);
          return true;
        }
      }

      return defaultPasteHandler({
        prioritizeMarkdownOverHTML: false,
        plainTextAsMarkdown: false,
      });
    },
    [],
  );

  // Page view, Suggesting mode, autocomplete and find: created with each editor instance.
  const editorPluginHooks = useRef<EditorPluginHooks>(DEFAULT_EDITOR_PLUGIN_HOOKS);
  const editorPlugins = useMemo(
    () => createEditorPlugins(editorPluginHooks),
    // A new set for each editor instance (fallback -> realtime), like the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockNoteSchema, pasteHandler, editorInstanceKey, crdtCollaboration.collaboration],
  );

  const editor = useCreateBlockNote(
    {
      schema: blockNoteSchema,
      pasteHandler,
      extensions: [editorPlugins.extension],
      _tiptapOptions: { editorProps: editorPlugins.editorProps },
      // Images are stored as files and linked, not embedded in the document.
      uploadFile: uploadEditorAsset,
      collaboration: crdtCollaboration.collaboration ?? undefined,
      initialContent: !isUsingCrdt && documentBlocks.length > 0 ? documentBlocks : undefined,
    },
    [blockNoteSchema, pasteHandler, editorInstanceKey, crdtCollaboration.collaboration],
  );

  // Footnote texts for printing a pageless document, collected just before the print starts.
  const [printNotes, setPrintNotes] = useState<{ text: string; kind: string }[]>([]);
  useEffect(() => {
    const collect = () => flushSync(() => setPrintNotes(collectFootnotes(editor.document as any[])));
    window.addEventListener('beforeprint', collect);
    return () => window.removeEventListener('beforeprint', collect);
  }, [editor]);

  const paginationConfigRef = useRef<PaginationConfig | null>(null);
  const pageCountRef = useRef(1);
  const paginationConfig = useMemo<PaginationConfig | null>(() => {
    if (isMobile || !isPageView) return null;
    const geometry = wordPage ?? {
      width: documentPageWidth, height: Math.round(documentPageWidth * (11 / 8.5)),
      top: 96, bottom: 96, left: 96, right: 96, header: 48, footer: 48,
    };
    const headers = wordSettings?.header || {};
    const footers = wordSettings?.footer || {};
    const firstDifferent = Boolean(wordSettings?.differentFirstPage);
    const start = Number(wordSettings?.pageNumberStart || 1);
    const fill = (template: string | undefined, page: number) => (template || '')
      .replace(/\{PAGE\}/g, String(page + start - 1))
      .replace(/\{PAGES\}/g, String(pageCountRef.current + start - 1))
      .replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] as string))
      .replace(/\t/g, '&emsp;&emsp;');
    const pick = (set: Record<string, { text: string; align?: string }>, page: number) => {
      const entry = page === 1 && firstDifferent ? set.first : (page % 2 === 0 && set.even ? set.even : set.default);
      if (!entry?.text) return '';
      const align = entry.align === 'center' || entry.align === 'right' ? entry.align : 'left';
      return `<span style="display:block;text-align:${align}">${fill(entry.text, page)}</span>`;
    };
    return {
      enabled: true,
      pageHeight: geometry.height,
      pageWidth: geometry.width,
      marginTop: geometry.top,
      marginBottom: geometry.bottom,
      marginLeft: geometry.left,
      marginRight: geometry.right,
      headerOffset: geometry.header,
      footerOffset: geometry.footer,
      gap: 18,
      headerFor: (page) => pick(headers, page),
      footerFor: (page) => pick(footers, page),
    };
  }, [documentPageWidth, isMobile, isPageView, wordPage, wordSettings]);
  paginationConfigRef.current = paginationConfig;

  editorPluginHooks.current = {
    ...editorPluginHooks.current,
    pagination: () => paginationConfigRef.current,
    onPages: (pages) => {
      pageCountRef.current = pages;
      setLayoutPageCount((current) => (current === pages ? current : pages));
    },
  };

  useEffect(() => {
    requestLayout(safeView(editor)?.dom as HTMLElement | undefined);
  }, [editor, paginationConfig]);

  // Suggesting mode and the suggestions in the document.
  const suggestingConfigRef = useRef({ enabled: false, author: 'Someone' });
  suggestingConfigRef.current = { enabled: isSuggesting, author: session?.displayName || user?.full_name || user?.email || 'Someone' };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionPopover, setSuggestionPopover] = useState<{ suggestion: Suggestion; top: number; left: number } | null>(null);
  editorPluginHooks.current = { ...editorPluginHooks.current, suggesting: () => suggestingConfigRef.current };
  useEffect(() => {
    if (!editor) return undefined;
    const refresh = () => {
      const view = safeView(editor);
      if (!view) return;
      const next = collectSuggestions(view.state);
      setSuggestions((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    refresh();
    editor.onMount?.(refresh);
    return editor.onChange(refresh);
  }, [editor]);
  const resolveSuggestion = useCallback((ids: string[] | null, accept: boolean) => {
    const view = safeView(editor);
    if (!view) return;
    const count = resolveSuggestions(view, ids, accept);
    setSuggestionPopover(null);
    if (count && !ids) toast.success(`${accept ? 'Accepted' : 'Rejected'} ${count} suggestion${count === 1 ? '' : 's'}`);
  }, [editor]);
  const handleSuggestionClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest?.('ins.ce-suggest-insert, del.ce-suggest-delete') as HTMLElement | null;
    if (!target) {
      if (suggestionPopover) setSuggestionPopover(null);
      return;
    }
    const id = target.dataset.suggestionId || '';
    const suggestion = suggestions.find((item) => item.id === id);
    const host = event.currentTarget.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (suggestion) setSuggestionPopover({ suggestion, top: rect.bottom - host.top + 6, left: Math.max(0, rect.left - host.left) });
  }, [suggestionPopover, suggestions]);

  const insertGhostBlocks = useCallback(
    (suggestion: AISuggestion) => {
      const parsedBlocks = suggestion.html
        ? (editor.tryParseHTMLToBlocks(preprocessRichDocumentHtml(suggestion.html)) as Block<any, any, any>[])
        : [];
      const fallbackText = stripHtmlToText(suggestion.html || suggestion.text);
      const generatedBlocks: Block<any, any, any>[] =
        parsedBlocks.length > 0
          ? parsedBlocks
          : fallbackText
            ? [
                {
                  type: suggestion.type === 'title' || suggestion.type === 'subtitle' ? 'heading' : 'paragraph',
                  props:
                    suggestion.type === 'title'
                      ? { level: 1 }
                      : suggestion.type === 'subtitle'
                        ? { level: 2 }
                        : {},
                  content: [{ type: 'text', text: fallbackText, styles: {} }],
                } as any,
              ]
            : [];
      const stableSuggestionId = suggestion.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-80);
      const nextBlocks = generatedBlocks.map((block, index) => ({
        ...block,
        id: `ai-suggestion-${stableSuggestionId}-${index}`,
      })) as Block<any, any, any>[];

      if (nextBlocks.length === 0) {
        return [];
      }

      const documentBlocks = getEditorBlocks(editor);
      const existingBlockIds = new Set(documentBlocks.map((block) => block.id));
      const blocksToInsert = nextBlocks.filter((block) => !existingBlockIds.has(block.id));
      const stableBlockIds = nextBlocks.map((block) => block.id);
      if (blocksToInsert.length === 0) {
        aiSuggestionAnchorBlockIdRef.current = stableBlockIds[stableBlockIds.length - 1] ?? null;
        return stableBlockIds;
      }
      const bibBlockIds = new Set(getManagedBibliographyBlocks(documentBlocks).map((b) => b.id));
      const referenceBlock =
        documentBlocks.find((block) => block.id === aiSuggestionAnchorBlockIdRef.current && !bibBlockIds.has(block.id)) ??
        (() => {
          const nonBibBlocks = documentBlocks.filter((b) => !bibBlockIds.has(b.id));
          return nonBibBlocks[nonBibBlocks.length - 1];
        })() ??
        documentBlocks[documentBlocks.length - 1];

      if (referenceBlock) {
        editor.insertBlocks(blocksToInsert as any, referenceBlock, 'after');
      }

      const insertedBlockIds = nextBlocks.map((block) => block.id).filter(Boolean) as string[];
      const lastInsertedBlock = nextBlocks[nextBlocks.length - 1];
      aiSuggestionAnchorBlockIdRef.current = lastInsertedBlock?.id ?? referenceBlock?.id ?? null;

      if (suggestion.type === 'title' && suggestion.text.trim()) {
        updateTitle(suggestion.text.trim());
      }

      if (suggestion.citations.length > 0) {
        const citationMap = new Map(
          suggestion.citations.map((c) => [c.displayText, c]),
        );
        const citationEntries = Array.from(citationMap.entries());
        insertedBlockIds.forEach((blockId) => {
          try {
            const block = editor.getBlock(blockId);
            if (!block || !Array.isArray(block.content)) {
              return;
            }
            let changed = false;
            const nextContent: unknown[] = [];
            (block.content as Array<{ type: string; text?: string; styles?: Record<string, unknown>; [k: string]: unknown }>).forEach((item) => {
              if (item.type !== 'text' || typeof item.text !== 'string') {
                nextContent.push(item);
                return;
              }
              let remaining = item.text;
              let didSplit = false;
              for (let ci = 0; ci < citationEntries.length; ci++) {
                const [displayText, citation] = citationEntries[ci];
                if (!remaining.includes(displayText)) {
                  continue;
                }
                const parts = remaining.split(displayText);
                for (let partIndex = 0; partIndex < parts.length; partIndex++) {
                  if (parts[partIndex]) {
                    nextContent.push({ type: 'text', text: parts[partIndex], styles: item.styles ?? {} });
                  }
                  if (partIndex < parts.length - 1) {
                    const bibtex = citation.bibtex || '';
                    const citationFormat = bibtex
                      ? formatEditorCitation(bibtex, citationStyle, citationMap.size)
                      : null;
                    nextContent.push({
                      type: 'aiCitation',
                      props: {
                        citationId: citation.id,
                        base64: citation.base64 || (bibtex ? encodeBibtexToBase64(bibtex) : ''),
                        displayText: citationFormat?.formatted.inText || displayText,
                        bibliography: citationFormat?.formatted.bibliography || '',
                        style: citationFormat?.style || citationStyle,
                        url: '',
                      },
                    });
                  }
                }
                didSplit = true;
                remaining = '';
                break;
              }
              if (!didSplit) {
                nextContent.push(item);
              } else {
                changed = true;
              }
            });
            if (changed) {
              editor.updateBlock(blockId, { content: nextContent } as any);
            }
          } catch {
            // block may have been removed
          }
        });
      }

      window.setTimeout(() => {
        const targetBlockId = aiSuggestionAnchorBlockIdRef.current;
        if (!targetBlockId) {
          return;
        }
        const targetElement = document.querySelector(`[data-id="${targetBlockId}"]`) as HTMLElement | null;
        targetElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);

      return insertedBlockIds;
    },
    [citationStyle, editor, updateTitle],
  );

  const removeGhostBlocks = useCallback(() => {
    setPendingGhostBlockIds((current) => {
      if (current.length === 0) {
        return current;
      }
      try {
        editor.removeBlocks(current);
      } catch {
        // blocks might already be removed
      }
      return [];
    });
    setGhostActionBarPosition(null);
  }, [editor]);

  const acceptGhostBlocks = useCallback((): string | null => {
    let lastBlockId: string | null = null;
    setPendingGhostBlockIds((current) => {
      if (current.length === 0) {
        return current;
      }
      lastBlockId = current[current.length - 1];
      current.forEach((blockId) => {
        const blockElement = editorSurfaceRef.current?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
        blockElement?.classList.remove('ai-ghost-block');
      });
      return [];
    });
    setGhostActionBarPosition(null);
    return lastBlockId;
  }, []);

  const syncGhostActionBar = useCallback(() => {
    if (pendingGhostBlockIds.length === 0) {
      setGhostActionBarPosition(null);
      return;
    }
    const lastBlockId = pendingGhostBlockIds[pendingGhostBlockIds.length - 1];
    const blockElement = editorSurfaceRef.current?.querySelector(`[data-id="${lastBlockId}"]`) as HTMLElement | null;
    if (!blockElement) {
      setGhostActionBarPosition(null);
      return;
    }
    const rect = blockElement.getBoundingClientRect();
    setGhostActionBarPosition({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, [pendingGhostBlockIds]);

  useEffect(() => {
    syncGhostActionBar();
  }, [syncGhostActionBar]);

  useEffect(() => {
    if (pendingGhostBlockIds.length === 0) {
      return;
    }
    const handleScroll = () => syncGhostActionBar();
    const scrollContainer = documentScrollContainerRef.current;
    window.addEventListener('resize', handleScroll);
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', handleScroll);
      scrollContainer?.removeEventListener('scroll', handleScroll);
    };
  }, [pendingGhostBlockIds, syncGhostActionBar]);

  useEffect(() => {
    pendingGhostBlockIds.forEach((blockId) => {
      const blockElement = editorSurfaceRef.current?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
      if (blockElement && !blockElement.classList.contains('ai-ghost-block')) {
        blockElement.classList.add('ai-ghost-block');
      }
    });
  }, [pendingGhostBlockIds]);

  useEffect(() => {
    setMounted(true);

    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);

    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  useEffect(() => {
    if (!documentId) {
      setIsDocumentStarred(false);
      setDocumentPageWidth(816);
      setCitationStyle('apa');
      setAreAIWritingSuggestionsEnabled(true);
      setAreAIReviewSuggestionsEnabled(true);
      return;
    }

    setIsDocumentStarred(loadStarredDocumentIds().has(documentId));
    if (typeof window !== 'undefined') {
      const legacyAISetting =
        readLocalSetting(`${AI_EDITOR_SUGGESTIONS_STORAGE_KEY}:${documentId}`) !== 'false';
      const storedWidth = Number.parseInt(readLocalSetting(`ai-editor-page-width:${documentId}`) || '', 10);
      setDocumentPageWidth(Number.isFinite(storedWidth) ? storedWidth : 816);
      setCitationStyle(
        readLocalSetting(`${AI_EDITOR_CITATION_STYLE_STORAGE_KEY}:${documentId}`) || 'apa',
      );
      const storedWriting = readLocalSetting(
        `${AI_EDITOR_WRITING_SUGGESTIONS_STORAGE_KEY}:${documentId}`,
      );
      const storedReview = readLocalSetting(
        `${AI_EDITOR_REVIEW_SUGGESTIONS_STORAGE_KEY}:${documentId}`,
      );
      setAreAIWritingSuggestionsEnabled(storedWriting ? storedWriting !== 'false' : legacyAISetting);
      setAreAIReviewSuggestionsEnabled(storedReview ? storedReview !== 'false' : legacyAISetting);
    }
  }, [documentId]);

  const setAutoSuggest = aiSuggestion.setAutoSuggest;
  useEffect(() => {
    setAutoSuggest(areAIWritingSuggestionsEnabled);
  }, [setAutoSuggest, areAIWritingSuggestionsEnabled]);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') {
      return;
    }

    writeLocalSetting(
      `${AI_EDITOR_CITATION_STYLE_STORAGE_KEY}:${documentId}`,
      citationStyle,
    );
  }, [citationStyle, documentId]);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') {
      return;
    }

    writeLocalSetting(
      `${AI_EDITOR_WRITING_SUGGESTIONS_STORAGE_KEY}:${documentId}`,
      String(areAIWritingSuggestionsEnabled),
    );
  }, [areAIWritingSuggestionsEnabled, documentId]);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') {
      return;
    }

    writeLocalSetting(
      `${AI_EDITOR_REVIEW_SUGGESTIONS_STORAGE_KEY}:${documentId}`,
      String(areAIReviewSuggestionsEnabled),
    );
  }, [areAIReviewSuggestionsEnabled, documentId]);

  useEffect(() => {
    trustedReferencesRef.current = null;
  }, [documentId]);

  const syncCitationStorageFromEditor = useCallback(
    (style: string, options?: { force?: boolean; now?: boolean }) => {
      if (!documentId || typeof window === 'undefined') {
        return;
      }
      if (isSyncingCitationsRef.current) {
        return;
      }
      isSyncingCitationsRef.current = true;

      let signatureBefore: string | null = null;
      try {
      // Called on every editor change: skip when no citation, style or
      // References text changed since the last completed sync.
      signatureBefore = getCitationSyncSignature(editor, documentId, style);
      if (!options?.force && signatureBefore === lastCitationSyncSignatureRef.current) {
        return;
      }

      const entries = new Map<string, AIEditorCitationStorageEntry>();
      const numbering = new Map<string, number>();
      editor.forEachBlock((block) => {
        const rewritten = rewriteCitationContent(block.content, style, entries, numbering);
        if (rewritten.changed) {
          editor.updateBlock(block.id, { content: rewritten.nextContent } as any);
        }
        return true;
      });

      const nextCitations = Array.from(entries.values());
      const referencesKey = `${style}\u0000${Array.from(entries.keys()).join('\u0001')}`;
      if (trustedReferencesRef.current === null && nextCitations.length > 0) {
        const section = getBibliographySection(getEditorBlocks(editor));
        const generated = section?.marked ? section.body.filter((block) => block.props?.ceRole === BIBLIOGRAPHY_ENTRY_ROLE).length : -1;
        trustedReferencesRef.current = generated === nextCitations.length ? referencesKey : '';
      }
      // Opening a document: its References already match its citations, so the CSL engine
      // is not run (a second or more on long documents) until a source or the style changes.
      const referencesTrusted = trustedReferencesRef.current === referencesKey;
      // After the first change the list follows the citations again for the rest of the visit.
      if (!referencesTrusted && trustedReferencesRef.current) trustedReferencesRef.current = '';

      // Use batch bibliography generation (like /research-agent) so the CSL
      // engine receives all entries at once and can apply the full style template.
      // Per-entry formatCitation often crashes inside citeproc-js on certain data;
      // the batch path in formatMultipleCitations handles this more reliably.
      if (nextCitations.length > 0) {
        try {
          const bibtexArray = nextCitations.map((c) => {
            const bib = c.base64 ? getBibtexFromBase64(c.base64) : null;
            return bib || '';
          }).filter(Boolean);

          // Building the list takes the CSL engine a second on a long document. When it is not
          // cached, the document shows first and the list is built just after (idle time).
          if (referencesTrusted) {
            // keep the saved list
          } else if (bibtexArray.length > 0 && !options?.now && peekBibliography(bibtexArray, style) === null) {
            if (!pendingBibliographyRef.current) {
              pendingBibliographyRef.current = true;
              const run = () => {
                pendingBibliographyRef.current = false;
                syncCitationStorageFromEditorRef.current?.(style, { force: true, now: true });
              };
              if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 1500 });
              else window.setTimeout(run, 200);
            }
            return;
          }

          if (bibtexArray.length > 0 && !referencesTrusted) {
            const batchBib = formatBibliographyOnly(bibtexArray, style);

            if (batchBib && !batchBib.includes('Error generating bibliography')) {
              const parser = new DOMParser();
              const bibDoc = parser.parseFromString(batchBib, 'text/html');
              const bibEntries = bibDoc.querySelectorAll('.csl-entry');

              bibEntries.forEach((entry, idx) => {
                if (idx < nextCitations.length) {
                  const html = entry.outerHTML;
                  nextCitations[idx].html = html;
                  nextCitations[idx].label = stripHtmlToText(html);
                }
              });
            }
          }
        } catch {
          // batch bibliography generation failed; individual entries remain unchanged
        }
      }

      if (!referencesTrusted) syncManagedBibliographySection(editor, nextCitations);
      writeLocalSetting(`ai-editor-citations:${documentId}`, JSON.stringify(nextCitations));
      window.dispatchEvent(
        new CustomEvent('ai-editor-citations-updated', {
          detail: { documentId, citations: nextCitations },
        }),
      );
      lastCitationSyncSignatureRef.current = getCitationSyncSignature(editor, documentId, style);
      } catch (error) {
        // This is background maintenance driven by editor change events; a
        // throw here surfaced as an uncaught error on every keystroke. Report
        // it once and retry only after the citations or References change.
        if (lastCitationSyncSignatureRef.current !== signatureBefore) {
          console.error('AI editor citation sync failed:', error);
        }
        lastCitationSyncSignatureRef.current = signatureBefore;
      } finally {
        isSyncingCitationsRef.current = false;
      }
    },
    [documentId, editor],
  );
  syncCitationStorageFromEditorRef.current = syncCitationStorageFromEditor;

  useEffect(() => {
    let isCancelled = false;

    syncCitationStorageFromEditor(citationStyle);
    void loadCslStyle(citationStyle)
      .then((loadedTemplate) => {
        if (!isCancelled && loadedTemplate) {
          // The template may have loaded after the first pass, so reformat
          // even though the document itself is unchanged.
          syncCitationStorageFromEditor(citationStyle, { force: true });
        }
      })
      .catch((error) => {
        console.warn('Failed to load CSL style for AI editor:', error);
      });

    return () => {
      isCancelled = true;
    };
  }, [citationStyle, syncCitationStorageFromEditor]);

  useEffect(() => {
    if (!canEdit) {
      setSurfaceMode('Viewing');
      return;
    }

    setSurfaceMode((current) => (current === 'Viewing' ? 'Editing' : current));
  }, [canEdit]);

  useEffect(() => {
    const nextItems = extractOutlineItems(editor);
    setOutlineItems(nextItems);
    setActiveOutlineId((current) => {
      if (current && nextItems.some((item) => item.id === current)) {
        return current;
      }

      return nextItems[0]?.id ?? null;
    });

    const timer = window.setTimeout(() => {
      const { humanScore: nextScore, flaggedCount: nextFlagged } = computeEditorHumanizerScore(editor);
      if (nextScore !== null) {
        setHumanScore(nextScore);
        setFlaggedCount(nextFlagged);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [editor]);

  useEffect(() => {
    setBookmarkItems((prev) => {
      const next = bookmarks.map((bookmark) => ({
        id: bookmark.blockId,
        title: bookmark.label,
        level: 1,
      }));
      if (
        prev.length === next.length &&
        prev.every((item, i) => item.id === next[i].id && item.title === next[i].title)
      ) {
        return prev;
      }
      return next;
    });
  }, [bookmarks]);

  const handleNewResearch = useCallback(() => {
    router.push('/');
  }, [router]);

  // While the session is still being checked the button already reads "Blank
  // document". A click then was taken as signed out: the sign-up dialog opened,
  // closed again once the account loaded, and the click was lost. Now it waits
  // for the check and then creates the document (or asks a signed-out visitor to sign up).
  const [isCreateQueued, setIsCreateQueued] = useState(false);
  const handleCreateDocument = useCallback(() => {
    if (authLoading) {
      setIsCreateQueued(true);
      return;
    }
    if (!isAuthenticated) {
      setAuthPrompt('signup');
      return;
    }
    const nextDocumentId = createDocument();
    trackAIEditorDocumentCreated({ source: 'manual' });
    router.push(`${editorPath()}?doc=${nextDocumentId}`);
  }, [authLoading, createDocument, isAuthenticated, router]);
  useEffect(() => {
    if (!isCreateQueued || authLoading) return;
    setIsCreateQueued(false);
    handleCreateDocument();
  }, [authLoading, handleCreateDocument, isCreateQueued]);
  // "?new=1" (the phone tab bar's centre button) starts a blank document once.
  const newRequested = searchParams.get('new') === '1' && !searchParams.get('doc');
  const newHandledRef = useRef(false);
  useEffect(() => {
    if (!newRequested || newHandledRef.current) return;
    newHandledRef.current = true;
    handleCreateDocument();
  }, [handleCreateDocument, newRequested]);

  // Opening a Word file from the documents home makes a new document with its formatting.
  // A template from the documents page: a new document, titled now and filled once it opens.
  const handleCreateFromTemplate = useCallback((templateId: string) => {
    const template = findTemplate(templateId);
    if (!template) return;
    if (!isAuthenticated) {
      setAuthPrompt('signup');
      return;
    }
    const nextDocumentId = createDocument();
    trackAIEditorDocumentCreated({ source: 'manual' });
    // The title is set with the content, once the document exists on the server.
    try {
      sessionStorage.setItem(PENDING_TEMPLATE_KEY, JSON.stringify({ documentId: nextDocumentId, templateId: template.id }));
    } catch {
      /* private mode: the document opens blank */
    }
    router.push(`${editorPath()}?doc=${nextDocumentId}`);
  }, [createDocument, isAuthenticated, router]);

  const handleImportWordFile = useCallback((file: File) => {
    if (!isAuthenticated) {
      setAuthPrompt('signup');
      return;
    }
    const pending = toast.loading(`Opening ${file.name}…`);
    void importWordFile(file)
      .then((result) => {
        toast.success(result.warnings.length ? `Opened. ${result.warnings[0]}` : 'Opened with its Word formatting', { id: pending });
        trackAIEditorDocumentCreated({ source: 'word_import' });
        router.push(`${editorPath()}?doc=${result.document.id}`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'The file could not be opened', { id: pending }));
  }, [isAuthenticated, router]);

  const handleDuplicateDocument = useCallback(() => {
    if (!documentSnapshot || !session) {
      return;
    }

    const nextDocumentId = provider.createDocument(session.sessionId);
    provider.updateTitle(nextDocumentId, session.sessionId, `${documentSnapshot.title} copy`);
    provider.updateBlocks(nextDocumentId, session.sessionId, documentSnapshot.blocks);
    trackAIEditorDocumentCreated({ source: 'duplicate' });
    router.push(`${editorPath()}?doc=${nextDocumentId}`);
  }, [documentSnapshot, provider, router, session]);

  const handleDeleteCurrentDocument = useCallback(() => {
    if (!documentId) {
      return;
    }

    // deleteDocument rejects for non-owners and on network/server errors; an
    // unhandled rejection here previously surfaced as a browser error.
    void deleteDocument(documentId)
      .then(() => {
        router.push(editorPath());
      })
      .catch((error) => {
        console.error('Failed to delete AI editor document:', error);
        toast.error(
          error instanceof Error && error.message
            ? `This document could not be moved to trash: ${error.message}`
            : 'This document could not be moved to trash. Please try again.',
        );
      });
  }, [deleteDocument, documentId, router]);

  const handleOpenDocsHome = useCallback(() => {
    router.push(editorPath());
  }, [router]);

  // The browser tab shows the open document's title, as in Docs and Word.
  useEffect(() => {
    if (!documentId) return undefined;
    const previous = document.title;
    document.title = `${documentTitle.trim() || 'Untitled document'} · Videmak`;
    return () => {
      document.title = previous;
    };
  }, [documentId, documentTitle]);

  // An open document's editor owns the whole phone screen; the tab bar steps aside.
  useHideMobileTabBar('ai-editor-document', Boolean(documentId));
  // The left app nav folds away (remembered), giving the page and the side rail's tools room.
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  useEffect(() => {
    try { setIsNavCollapsed(window.localStorage.getItem('videmak_nav_collapsed') === '1'); } catch { /* storage blocked */ }
  }, []);
  const toggleNavCollapsed = useCallback(() => {
    setIsNavCollapsed((current) => {
      try { window.localStorage.setItem('videmak_nav_collapsed', current ? '0' : '1'); } catch { /* storage blocked */ }
      return !current;
    });
  }, []);
  // Documents, Library and Find papers slide in from the left in place of the menu; AI Chat opens
  // on the right. Links such as /editor?tool=papers (and the old /library, /papers, /chat) open them.
  const sideloads = useSideloads();
  const toolParam = searchParams.get('tool');
  useEffect(() => {
    if (toolParam === 'documents' || toolParam === 'library' || toolParam === 'papers' || toolParam === 'chat') showSideload(toolParam);
  }, [toolParam]);
  // In a document AI Chat is the document's own chat (it reads the page): the app chat moves into it.
  useEffect(() => {
    if (!documentId || !sideloads.chat) return;
    closeSideloadChat();
    const handed = sideloads.mentions;
    if (handed.length) {
      setChatMentions((current) => [...current, ...handed.filter((mention) => !current.some((item) => item.id === mention.id))]);
      setSideloadMentions([]);
    }
    setAssistantTab('chat');
  }, [documentId, sideloads.chat, sideloads.mentions]);
  // One Library (or Find papers) at a time: the menu's drawer on the left closes the rail's panel.
  useEffect(() => {
    if (sideloads.drawer) setAssistantTab((current) => (current === sideloads.drawer ? null : current));
  }, [sideloads.drawer]);
  // The editor's side rail has its own tools, so floating launchers step aside (a no-op here).
  useHideFloatingLaunchers('ai-editor-document', Boolean(documentId));

  useEffect(() => {
    if (!isAppMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAppMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isAppMenuOpen]);
  useEffect(() => setIsAppMenuOpen(false), [documentId]);

  // The host's navigation (config.renderNavigation) also opens over the editor from the
  // phone options sheet ("App menu"); wide screens show it as the left column.
  const editorConfig = useEditorConfig();
  const handleMainMenuClick = useCallback(() => {
    if (editorConfig.renderNavigation || window.innerWidth < 1280) setIsAppMenuOpen((open) => !open);
    else toggleNavCollapsed();
  }, [editorConfig.renderNavigation, toggleNavCollapsed]);

  const handleSelectDocument = useCallback(
    (nextDocumentId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('doc', nextDocumentId);
      params.delete('access');
      router.push(`${editorPath()}?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleDeleteDocument = useCallback(
    async (nextDocumentId: string) => {
      await deleteDocument(nextDocumentId);

      if (documentId === nextDocumentId) {
        router.push(editorPath());
      }
    },
    [deleteDocument, documentId, router],
  );

  const handleRenameDocument = useCallback(
    async (nextDocumentId: string, nextTitle: string) => {
      await renameDocument(nextDocumentId, nextTitle);
    },
    [renameDocument],
  );

  const handleAuthRedirect = useCallback(
    (mode: 'login' | 'signup') => {
      if (!documentId) {
        return;
      }

      // The host's sign-in pages return to a relative `next` path.
      const currentUrl = `${editorPath()}?doc=${documentId}`;
      const targetPath = mode === 'signup' ? '/signup' : '/login';
      const params = new URLSearchParams();
      params.set('inviteAIEditor', '1');
      if (invitedEmailParam || documentSnapshot?.members[0]?.email) {
        params.set('invitedEmail', invitedEmailParam || documentSnapshot?.members[0].email || '');
      }
      params.set('next', currentUrl);
      router.push(`${targetPath}?${params.toString()}`);
    },
    [documentId, documentSnapshot?.members, invitedEmailParam, router],
  );

  const handleEditorChange = useCallback(() => {
    const nextItems = extractOutlineItems(editor);

    setOutlineItems((prev) => {
      if (
        prev.length === nextItems.length &&
        prev.every((item, i) => item.id === nextItems[i].id && item.title === nextItems[i].title && item.level === nextItems[i].level)
      ) {
        return prev;
      }
      return nextItems;
    });
    setActiveOutlineId((current) => {
      if (current && nextItems.some((item) => item.id === current)) {
        return current;
      }

      return nextItems[0]?.id ?? null;
    });

    if (!isUsingCrdt) {
      updateBlocks(getEditorBlocks(editor));
    }

    if (canEdit && session) {
      const nextBlockId = getActiveCursorBlockId(editor, {
        ...session,
        role: effectiveRole,
        lastSeenAt: Date.now(),
        isCurrentUser: true,
      } as AIEditorCollaborator);

      if (nextBlockId) {
        lastCursorBlockIdRef.current = nextBlockId;
        updateCursor({
          blockId: nextBlockId,
          label: 'Editing',
          updatedAt: Date.now(),
        });
      }
    }

    if (humanizerTimerRef.current) {
      window.clearTimeout(humanizerTimerRef.current);
    }
    humanizerTimerRef.current = window.setTimeout(() => {
      const { humanScore: nextScore, flaggedCount: nextFlagged } = computeEditorHumanizerScore(editor);
      if (nextScore !== null) {
        setHumanScore(nextScore);
        setFlaggedCount(nextFlagged);
      }
    }, 600);
  }, [canEdit, editor, effectiveRole, isUsingCrdt, session, updateBlocks, updateCursor]);

  useEffect(() => {
    if (!isParagraphReviewOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsParagraphReviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isParagraphReviewOpen]);

  const handleOpenParagraphReview = useCallback(() => {
    const blocks = collectScoredBlocks(editor);
    setScoredBlocks(blocks);
    setHumanizeError(null);
    setIsParagraphReviewOpen(true);
  }, [editor]);

  const handleHumanizeBlock = useCallback(
    async (blockId: string) => {
      if (isAIToolsAccessLoading) {
        toast('Checking humanizer access…');
        return;
      }
      if (!canUseHumanizer) {
        toast.error('Humanizer requires an active subscription.');
        return;
      }

      const target = scoredBlocks.find((b) => b.blockId === blockId);
      if (!target || !target.isScannable) return;

      if (humanizer.wordsLimit > 0 && target.wordCount > humanizer.wordsLimit) {
        toast.error(`This paragraph has ${target.wordCount} words, exceeding the ${humanizer.wordsLimit} word limit.`);
        return;
      }

      setHumanizingBlockId(blockId);
      setHumanizeError(null);

      try {
        const response = await humanizeText(target.text);
        if (!response.success || !response.humanized_text) {
          throw new Error(response.error || 'Humanization failed.');
        }

        const humanizedText = response.humanized_text.trim();
        if (!humanizedText || humanizedText === target.text) {
          throw new Error('Humanization produced no change.');
        }

        const editorBlock = editor.getBlock(blockId);
        if (editorBlock) {
          editor.updateBlock(blockId, {
            content: humanizedText,
          } as any);
        }

        setScoredBlocks((prev) => {
          const nextResult = scoreTextForAI(humanizedText);
          return prev.map((b) =>
            b.blockId === blockId
              ? { ...b, text: humanizedText, score: nextResult.score, severity: getSeverity(nextResult.score), reasons: nextResult.reasons, wordCount: humanizedText.split(/\s+/).filter(Boolean).length }
              : b,
          );
        });

        const { humanScore: nextScore, flaggedCount: nextFlagged } = computeEditorHumanizerScore(editor);
        if (nextScore !== null) {
          setHumanScore(nextScore);
          setFlaggedCount(nextFlagged);
        }
      } catch (error: any) {
        setHumanizeError(error?.message || 'Humanization failed.');
      } finally {
        setHumanizingBlockId((current) => (current === blockId ? null : current));
      }
    },
    [canUseHumanizer, editor, humanizer.wordsLimit, isAIToolsAccessLoading, scoredBlocks],
  );

  const handleEditorSelectionChange = useCallback(() => {
    if (!canEdit || !session) {
      return;
    }

    const nextBlockId = getActiveCursorBlockId(editor, {
      ...session,
      role: effectiveRole,
      lastSeenAt: Date.now(),
      isCurrentUser: true,
    } as AIEditorCollaborator);

    if (!nextBlockId || lastCursorBlockIdRef.current === nextBlockId) {
      return;
    }

    lastCursorBlockIdRef.current = nextBlockId;
    updateCursor({
      blockId: nextBlockId,
      label: 'Editing',
      updatedAt: Date.now(),
    });
  }, [canEdit, editor, effectiveRole, session, updateCursor]);

  const handleOutlineSelect = useCallback((itemId: string) => {
    setActiveOutlineId(itemId);

    const blockElement = document.querySelector(`[data-id="${itemId}"]`) as HTMLElement | null;
    blockElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // On phones the outline covers the page; close it once a heading is chosen.
    setIsOutlinePanelVisible(false);
  }, []);

  const handleAddBookmark = useCallback(() => {
    if (!canEdit) {
      return;
    }

    const blockId = session
      ? getActiveCursorBlockId(editor, {
          ...session,
          role: effectiveRole,
          lastSeenAt: Date.now(),
          isCurrentUser: true,
        })
      : null;

    if (!blockId) {
      return;
    }

    const selectedText = editor.getSelectedText().trim();
    const defaultLabel = selectedText || 'Bookmark';
    void editorPrompt({ title: 'Add bookmark', label: 'Bookmark name', defaultValue: defaultLabel, okLabel: 'Add' }).then((nextLabel) => {
      if (!nextLabel) return;
      addBookmark({ label: nextLabel, blockId });
      setActiveOutlineId(blockId);
    });
  }, [addBookmark, canEdit, editor, effectiveRole, session]);

  useEffect(() => {
    if (
      !documentId ||
      !isUsingCrdt ||
      !crdtCollaboration.shouldSeedInitialContent ||
      !documentSnapshot?.blocks.length ||
      !canEdit
    ) {
      return;
    }

    if (seededCrdtDocumentIdsRef.current.has(documentId)) {
      return;
    }

    seededCrdtDocumentIdsRef.current.add(documentId);
    editor.replaceBlocks(editor.document, documentBlocks as any);
    // Loading the stored text is not an edit: the first Ctrl+Z must not empty the document.
    const clearUndoHistory = () => {
      const view = (editor as any)._tiptapEditor?.view;
      const undoPlugin = view?.state.plugins.find((plugin: any) => String(plugin.key).startsWith('y-undo$'));
      undoPlugin?.getState(view.state)?.undoManager?.clear();
    };
    clearUndoHistory();
    window.setTimeout(clearUndoHistory, 0);
  }, [
    canEdit,
    crdtCollaboration.shouldSeedInitialContent,
    documentId,
    documentBlocks,
    documentSnapshot?.blocks,
    editor,
    isUsingCrdt,
  ]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    if (!root) {
      return;
    }

    const applySpellcheckState = () => {
      const editableNodes = root.querySelectorAll<HTMLElement>('[contenteditable="true"]');
      const value = isSpellcheckEnabled ? 'true' : 'false';
      editableNodes.forEach((node) => {
        // Runs on every editor DOM change; only write when needed so the
        // editor does not receive a redundant attribute mutation each time.
        if (node.getAttribute('spellcheck') !== value) {
          node.setAttribute('spellcheck', value);
        }
      });
    };

    applySpellcheckState();

    const observer = new MutationObserver(() => {
      applySpellcheckState();
    });

    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
    // The surface mounts with the document: apply the setting then too.
  }, [isSpellcheckEnabled, documentSnapshot?.id]);

  useEffect(() => {
    editor.isEditable = isWritingEnabled;
  }, [editor, isWritingEnabled]);

  useEffect(() => {
    if (areAIReviewSuggestionsEnabled && isWritingEnabled && isAuthenticated) {
      return;
    }

    if (reviewDebounceTimerRef.current !== null) {
      window.clearTimeout(reviewDebounceTimerRef.current);
      reviewDebounceTimerRef.current = null;
    }
    reviewAbortControllerRef.current?.abort();
    setIsReviewLoading(false);
    setReviewError(null);
    setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
    setActiveReviewIssueId(null);
  }, [areAIReviewSuggestionsEnabled, isAuthenticated, isWritingEnabled]);

  useEffect(
    () => () => {
      if (reviewDebounceTimerRef.current !== null) {
        window.clearTimeout(reviewDebounceTimerRef.current);
      }
      reviewAbortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!reviewContextMenu) {
      return;
    }

    const closeMenu = () => setReviewContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [reviewContextMenu]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    if (!root || !canComment) {
      setSelectionBubble(null);
      return;
    }

    const updateBubble = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelectionBubble(null);
        return;
      }

      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer)) {
        setSelectionBubble(null);
        return;
      }

      const selectedText = sel.toString().trim();
      if (!selectedText) {
        setSelectionBubble(null);
        return;
      }

      const blockEl = (range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement
      )?.closest('[data-id]') as HTMLElement | null;
      if (!blockEl) {
        setSelectionBubble(null);
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();
      setSelectionBubble({
        top: rangeRect.top - rootRect.top + root.scrollTop,
        right: 4,
        blockId: blockEl.getAttribute('data-id') || '',
        selectedText,
      });
    };

    const handleMouseUp = () => {
      window.setTimeout(updateBubble, 10);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) updateBubble();
    };
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelectionBubble(null);
    };

    root.addEventListener('mouseup', handleMouseUp);
    root.addEventListener('keyup', handleKeyUp);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      root.removeEventListener('mouseup', handleMouseUp);
      root.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [canComment]);

  const handleStartWriting = useCallback(
    (config: StartWritingConfig) => {
      removeGhostBlocks();
      const documentBlocks = getEditorBlocks(editor);
      const bibBlockIds = new Set(getManagedBibliographyBlocks(documentBlocks).map((b) => b.id));
      const nonBibBlocks = documentBlocks.filter((b) => !bibBlockIds.has(b.id));
      const lastBlock = nonBibBlocks[nonBibBlocks.length - 1] ?? null;
      aiSuggestionAnchorBlockIdRef.current = lastBlock?.id ?? null;
      setIsStartWritingDialogOpen(false);
      setIsStartWritingFlow(true);
      setActiveAISuggestion(null);
      aiSuggestion.setSourceType(config.sourceType);
      aiSuggestion.setSelectedDocuments(config.selectedDocuments);
      aiSuggestion.setSelectedFolderId(config.selectedFolderId);
      void aiSuggestion.startWriting(
        config.topic,
        lastBlock?.id ?? null,
        documentSnapshot?.revision ?? null,
        {
          sourceType: config.sourceType,
          selectedDocumentIds: config.selectedDocuments.map((document: { id: string }) => document.id),
          folderId: config.selectedFolderId,
        },
      );
    },
    [aiSuggestion, documentSnapshot?.revision, editor, removeGhostBlocks],
  );

  const handleInlineSuggest = useCallback(async () => {
    if (!areAIWritingSuggestionsEnabled || !isWritingEnabled) {
      return;
    }

    removeGhostBlocks();
    const anchorBlock = getCurrentEditorBlock(editor) ?? getEditorBlocks(editor)[getEditorBlocks(editor).length - 1];
    aiSuggestionAnchorBlockIdRef.current = anchorBlock?.id ?? null;
    setIsStartWritingFlow(false);
    setActiveAISuggestion(null);
    setCursorActionBar((current) => ({
      ...current,
      visible: true,
      loading: true,
    }));

    try {
      const documentHtml =
        editorSurfaceRef.current?.querySelector('[contenteditable="true"]')?.innerHTML ??
        getDocumentPlainText(editor);
      const documentText = getDocumentPlainText(editor);
      const topic =
        documentTitle.trim() ||
        outlineItems[0]?.title ||
        documentText.slice(0, 120) ||
        'Document draft';

      await aiSuggestion.continueWriting({
        topic,
        documentContent: documentHtml,
        previousParagraph: getPreviousParagraphText(editor, anchorBlock?.id ?? null),
        cursorPosition: editor.getSelection()?.blocks?.length ?? 0,
        targetBlockId: anchorBlock?.id ?? null,
        documentRevision: documentSnapshot?.revision ?? null,
      });
    } catch (error) {
      console.error('AI editor inline suggestion failed:', error);
      setCursorActionBar((current) => ({
        ...current,
        visible: false,
        loading: false,
      }));
    }
  }, [aiSuggestion, areAIWritingSuggestionsEnabled, documentSnapshot?.revision, documentTitle, editor, isWritingEnabled, outlineItems, removeGhostBlocks]);

  const requestActiveBlockReview = useCallback(
    async (
      force = false,
      options?: AIEditorReviewRequestOptions,
    ): Promise<AIEditorReviewIssue[]> => {
      if (reviewRecoveryInFlightRef.current) return [];

      if (!areAIReviewSuggestionsEnabled || !isWritingEnabled || !isAuthenticated) {
        setIsReviewLoading(false);
        setReviewError(null);
        setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
        setActiveReviewIssueId(null);
        reviewAbortControllerRef.current?.abort();
        return [];
      }

      const currentBlock = options?.blockId ? editor.getBlock(options.blockId) : getCurrentEditorBlock(editor);
      if (!currentBlock) {
        setIsReviewLoading(false);
        setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
        setActiveReviewIssueId(null);
        return [];
      }

      const managedBibliographyIds = new Set(
        getManagedBibliographyBlocks(getEditorBlocks(editor)).map((block) => block.id),
      );
      const serializedBlock = serializeReviewableBlockContent(currentBlock.content);

      if (!isReviewEligibleBlock(currentBlock, managedBibliographyIds) || !serializedBlock) {
        setIsReviewLoading(false);
        setReviewError(null);
        setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
        setActiveReviewIssueId(null);
        return [];
      }

      const text = serializedBlock.reviewText;
      if (text.split(/\s+/).filter(Boolean).length < 4) {
        setIsReviewLoading(false);
        setReviewError(null);
        setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
        setActiveReviewIssueId(null);
        return [];
      }

      if (!force && lastReviewedBlockTextRef.current.get(currentBlock.id) === text) {
        return reviewIssuesRef.current[currentBlock.id] ?? [];
      }

      if (!force && reviewPausedForCreditsRef.current) {
        setIsReviewLoading(false);
        return [];
      }

      reviewAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      reviewAbortControllerRef.current = abortController;
      setIsReviewLoading(true);
      setReviewError(null);

      try {
        const requestId = crypto.randomUUID();
        const data = await postDurableJson<any>(
          '/api/ai-editor/review',
          {
            request_id: requestId,
            text,
            block_id: currentBlock.id,
            document_title: documentTitle,
            document_summary: getDocumentPlainText(editor).slice(0, 1200),
            previous_text: getPreviousParagraphText(editor, currentBlock.id),
            next_text: getNextParagraphText(editor, currentBlock.id),
            focus_text: options?.focusText,
            preferred_action: options?.preferredAction,
            citation_placeholders: serializedBlock.citationPlaceholders,
            max_issues: 5,
          },
          {
            requestId,
            signal: abortController.signal,
            onQueued: ({ job_id }) => {
              if (!documentId) return;
              window.localStorage.setItem(
                aiEditorReviewJobStorageKey(documentId),
                JSON.stringify({
                  jobId: job_id,
                  blockId: currentBlock.id,
                  text,
                } satisfies RememberedAIEditorReview),
              );
            },
          },
        );
        if (documentId) {
          window.localStorage.removeItem(aiEditorReviewJobStorageKey(documentId));
        }
        if (!data?.success) {
          throw new Error(data?.error || 'Review request failed.');
        }
        window.dispatchEvent(new CustomEvent('credits-updated'));

        const issues = Array.isArray(data.issues) ? (data.issues as AIEditorReviewIssue[]) : [];
        const mappedIssues = issues
          .map((issue) => {
            const visibleStart = reviewOffsetToVisibleOffset(serializedBlock, issue.start_offset);
            const visibleEnd = reviewOffsetToVisibleOffset(serializedBlock, issue.end_offset);
            if (visibleStart === null || visibleEnd === null) {
              return null;
            }
            return {
              ...issue,
              block_id: issue.block_id ?? currentBlock.id,
              visible_start_offset: visibleStart,
              visible_end_offset: visibleEnd,
            } satisfies AIEditorReviewIssue;
          })
          .filter(Boolean) as AIEditorReviewIssue[];
        lastReviewedBlockTextRef.current.set(currentBlock.id, text);
        setReviewIssuesByBlockId(
          mappedIssues.length > 0
            ? { [currentBlock.id]: mappedIssues }
            : {},
        );
        setReviewError(null);
        setActiveReviewIssueId((current) => {
          if (current && mappedIssues.some((issue) => issue.id === current)) {
            return current;
          }
          return null;
        });
        trackAIEditorReviewCompleted(mappedIssues.length, {
          has_focus_text: Boolean(options?.focusText),
          preferred_action: options?.preferredAction,
        });
        return mappedIssues;
      } catch (error) {
        if (abortController.signal.aborted) {
          return [];
        }
        console.error('AI editor review failed:', error);
        if (documentId) {
          window.localStorage.removeItem(aiEditorReviewJobStorageKey(documentId));
        }
        const reviewMessage = error instanceof Error ? error.message : '';
        if (/credit/i.test(reviewMessage) && /insufficient|need more|purchase|add credits/i.test(reviewMessage)) {
          reviewPausedForCreditsRef.current = true;
        }
        setReviewError(error instanceof Error ? error.message : 'Review failed.');
        return [];
      } finally {
        if (reviewAbortControllerRef.current === abortController) {
          reviewAbortControllerRef.current = null;
        }
        setIsReviewLoading(false);
      }
    },
    [areAIReviewSuggestionsEnabled, documentId, documentTitle, editor, isAuthenticated, isWritingEnabled],
  );

  useEffect(() => {
    if (
      !documentId
      || !areAIReviewSuggestionsEnabled
      || !isWritingEnabled
      || !isAuthenticated
      || typeof window === 'undefined'
    ) {
      return;
    }

    const storageKey = aiEditorReviewJobStorageKey(documentId);
    let remembered: RememberedAIEditorReview | null = null;
    try {
      remembered = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
    } catch {
      window.localStorage.removeItem(storageKey);
    }
    if (!remembered?.jobId || !remembered.blockId) return;

    const currentBlock = editor.getBlock(remembered.blockId);
    if (!currentBlock) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    const serializedBlock = serializeReviewableBlockContent(currentBlock.content);
    if (!serializedBlock || serializedBlock.reviewText !== remembered.text) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    let disposed = false;
    reviewRecoveryInFlightRef.current = true;
    setIsReviewLoading(true);
    void (async () => {
      try {
        const detail = await getJob(remembered!.jobId);
        if (
          detail.status === 'failed'
          || detail.status === 'cancelled'
          || detail.status === 'dead_letter'
        ) {
          throw new Error(detail.error || 'The saved writing review could not be completed.');
        }
        const data = detail.status === 'completed'
          ? detail.result_json
          : await waitForJob(remembered!.jobId);
        if (!data?.success) throw new Error(String(data?.error || 'Review failed.'));
        if (disposed) return;

        const issues = Array.isArray(data.issues)
          ? (data.issues as unknown as AIEditorReviewIssue[])
          : [];
        const mappedIssues = issues
          .map((issue) => {
            const visibleStart = reviewOffsetToVisibleOffset(serializedBlock, issue.start_offset);
            const visibleEnd = reviewOffsetToVisibleOffset(serializedBlock, issue.end_offset);
            if (visibleStart === null || visibleEnd === null) return null;
            return {
              ...issue,
              block_id: issue.block_id ?? remembered!.blockId,
              visible_start_offset: visibleStart,
              visible_end_offset: visibleEnd,
            } satisfies AIEditorReviewIssue;
          })
          .filter(Boolean) as AIEditorReviewIssue[];

        lastReviewedBlockTextRef.current.set(remembered!.blockId, remembered!.text);
        setReviewIssuesByBlockId(
          mappedIssues.length > 0 ? { [remembered!.blockId]: mappedIssues } : {},
        );
        setActiveReviewIssueId(null);
        setReviewError(null);
        trackAIEditorReviewCompleted(mappedIssues.length, { recovered_after_refresh: true });
        window.dispatchEvent(new CustomEvent('credits-updated'));
      } catch (recoveryError) {
        if (!disposed) {
          setReviewError(
            recoveryError instanceof Error
              ? recoveryError.message
              : 'The saved writing review could not be restored.',
          );
        }
      } finally {
        window.localStorage.removeItem(storageKey);
        reviewRecoveryInFlightRef.current = false;
        if (!disposed) setIsReviewLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    areAIReviewSuggestionsEnabled,
    documentId,
    editor,
    isAuthenticated,
    isWritingEnabled,
  ]);

  const scheduleActiveBlockReview = useCallback(
    (force = false) => {
      if (reviewDebounceTimerRef.current !== null) {
        window.clearTimeout(reviewDebounceTimerRef.current);
        reviewDebounceTimerRef.current = null;
      }

      if (!areAIReviewSuggestionsEnabled || !isWritingEnabled || !isAuthenticated) {
        reviewAbortControllerRef.current?.abort();
        setIsReviewLoading(false);
        setReviewError(null);
        setReviewIssuesByBlockId(current => Object.keys(current).length ? {} : current);
        setActiveReviewIssueId(null);
        return;
      }

      reviewDebounceTimerRef.current = window.setTimeout(() => {
        reviewDebounceTimerRef.current = null;
        void requestActiveBlockReview(force);
      }, force ? 400 : 1200);
    },
    [areAIReviewSuggestionsEnabled, isAuthenticated, isWritingEnabled, requestActiveBlockReview],
  );

  useEffect(() => {
    if (!session || !documentSnapshot) {
      return;
    }

    handleEditorSelectionChange();
    scheduleActiveBlockReview();
  }, [documentSnapshot, handleEditorSelectionChange, scheduleActiveBlockReview, session]);

  const dismissReviewIssue = useCallback(
    (issueId: string, blockId: string | null | undefined) => {
      if (!blockId) {
        return;
      }

      setReviewIssuesByBlockId((current) => {
        const existing = current[blockId] ?? [];
        const nextIssues = existing.filter((issue) => issue.id !== issueId);
        if (nextIssues.length === 0) {
          return {};
        }
        return { [blockId]: nextIssues };
      });
      setActiveReviewIssueId((current) => (current === issueId ? null : current));
    },
    [],
  );

  const handleAcceptReviewIssue = useCallback(() => {
    if (!activeReviewIssue?.block_id) {
      return;
    }

    const block = editor.getBlock(activeReviewIssue.block_id);
    if (!block || !Array.isArray(block.content)) {
      setReviewError('This suggestion could not be applied safely.');
      return;
    }

    // In Suggesting mode the fix becomes a suggested edit to accept or reject.
    const view = safeView(editor);
    if (isSuggesting && view && activeReviewIssue.original_text) {
      const range = findTextInBlock(view.state, activeReviewIssue.block_id, activeReviewIssue.original_text);
      if (range && replaceAsSuggestion(view, range.from, range.to, activeReviewIssue.suggested_text, AI_AUTHOR)) {
        lastReviewedBlockTextRef.current.delete(activeReviewIssue.block_id);
        setReviewError(null);
        dismissReviewIssue(activeReviewIssue.id, activeReviewIssue.block_id);
        return;
      }
    }

    const { nextContent, changed } = rewriteReviewableBlockContent(
      block.content,
      activeReviewIssue.start_offset,
      activeReviewIssue.end_offset,
      activeReviewIssue.suggested_text,
    );

    if (!changed || nextContent.length === 0) {
      setReviewError('This suggestion could not be applied safely.');
      return;
    }

    editor.updateBlock(activeReviewIssue.block_id, {
      content: nextContent,
    } as any);
    lastReviewedBlockTextRef.current.delete(activeReviewIssue.block_id);
    setReviewError(null);
    dismissReviewIssue(activeReviewIssue.id, activeReviewIssue.block_id);
    window.setTimeout(() => {
      scheduleActiveBlockReview(true);
    }, 80);
  }, [activeReviewIssue, dismissReviewIssue, editor, isSuggesting, scheduleActiveBlockReview]);

  const handleRunSelectionReview = useCallback(
    async (preferredAction: 'grammar' | 'rewrite') => {
      const selection = reviewContextMenu?.selection ?? selectedReviewRange;
      setReviewContextMenu(null);
      if (!selection) {
        return;
      }

      const existingIssues = reviewIssuesByBlockId[selection.blockId] ?? [];
      const existingMatch = findReviewIssueOverlappingSelection(
        existingIssues,
        selection.startOffset,
        selection.endOffset,
      );
      if (existingMatch && (preferredAction === 'grammar' || existingMatch.category === 'rewrite')) {
        setActiveReviewIssueId(existingMatch.id);
        return;
      }

      const issues = await requestActiveBlockReview(true, {
        blockId: selection.blockId,
        focusText: selection.selectedText,
        preferredAction,
      });
      if (issues.length === 0) {
        setReviewError(
          preferredAction === 'rewrite'
            ? 'No rewrite suggestion was found for this selection.'
            : 'No grammar suggestion was found for this selection.',
        );
        return;
      }

      const matchedIssue =
        findReviewIssueOverlappingSelection(issues, selection.startOffset, selection.endOffset) ?? issues[0];
      setActiveReviewIssueId(matchedIssue.id);
    },
    [requestActiveBlockReview, reviewContextMenu, reviewIssuesByBlockId, selectedReviewRange],
  );

  const handleEditorContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!areAIReviewSuggestionsEnabled || !isWritingEnabled || !isAuthenticated) {
        setReviewContextMenu(null);
        return;
      }

      const selection = resolveSelectedReviewRange();
      if (!selection) {
        setReviewContextMenu(null);
        return;
      }

      event.preventDefault();
      setSelectedReviewRange(selection);
      setReviewContextMenu({
        position: {
          top: Math.min(event.clientY, window.innerHeight - 140),
          left: Math.min(event.clientX, window.innerWidth - 220),
        },
        selection,
      });
    },
    [areAIReviewSuggestionsEnabled, isAuthenticated, isWritingEnabled, resolveSelectedReviewRange],
  );

  const persistAcceptedAISuggestion = useCallback(
    async (suggestion: AISuggestion, recoveredTargetBlockId: string | null): Promise<{ documentRevision: number | null; targetBlockId: string | null }> => {
      aiSuggestionAnchorBlockIdRef.current = recoveredTargetBlockId;
      const stableBlockIds = insertGhostBlocks(suggestion);
      if (stableBlockIds.length === 0) {
        throw new Error('The AI suggestion did not contain insertable content.');
      }

      const committedRevision = isUsingCrdt
        ? await crdtCollaboration.flush()
        : await flushBlocks(getEditorBlocks(editor));
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle), 0);

      const lastBlockId = stableBlockIds[stableBlockIds.length - 1];
      try {
        editor.setTextCursorPosition(lastBlockId, 'end');
      } catch {
        // The accepted block may have been concurrently moved by another editor.
      }
      return { documentRevision: committedRevision, targetBlockId: lastBlockId };
    },
    [citationStyle, crdtCollaboration, editor, flushBlocks, insertGhostBlocks, isUsingCrdt, syncCitationStorageFromEditor],
  );

  const handleAcceptAISuggestion = useCallback(async () => {
    await aiSuggestion.acceptSuggestion(
      persistAcceptedAISuggestion,
      isStartWritingFlow ? 'auto' : 'stop',
    );
  }, [aiSuggestion, isStartWritingFlow, persistAcceptedAISuggestion]);

  const handleRetryAISuggestion = useCallback(() => {
    // tryAgain() first dismisses the current suggestion on the server and does
    // not catch that request; the suggestion stays on screen to retry.
    void aiSuggestion.tryAgain().catch((error) => {
      console.error('AI editor could not request another suggestion:', error);
    });
  }, [aiSuggestion]);

  const handleConcludeAISuggestion = useCallback(async () => {
    await aiSuggestion.acceptSuggestion(persistAcceptedAISuggestion, 'conclude');
  }, [aiSuggestion, persistAcceptedAISuggestion]);

  const handleStopAISuggestion = useCallback(() => {
    void aiSuggestion.stop();
  }, [aiSuggestion]);

  const handleCitationView = useCallback((metadata: CitationMetadata) => {
    if (metadata.doi) {
      window.open(`https://doi.org/${metadata.doi}`, '_blank', 'noopener,noreferrer');
      return;
    }

    if (metadata.url) {
      window.open(metadata.url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const handleCitationPick = useCallback(
    async (libraryDocument: LibraryDocumentResponse) => {
      if (!documentId) {
        return;
      }

      setIsInsertingCitation(true);
      try {
        const resolved = await resolveLibraryCitationBibtex(libraryDocument, citationStyle);
        const base64 = encodeBibtexToBase64(resolved.bibtex);
        const selectedText = editor.getSelectedText().trim();
        const tiptapEditor = (editor as any)._tiptapEditor;
        const selectionTo = tiptapEditor?.state?.selection?.to;
        const currentCitations = new Map<string, number>();
        editor.forEachBlock((block) => {
          const content = Array.isArray(block.content) ? block.content : [];
          content.forEach((item) => {
            if (!isAICitationInlineContent(item) || !item.props?.base64) {
              return;
            }

            const bibtex = getBibtexFromBase64(item.props.base64);
            if (!bibtex) {
              return;
            }

            const fingerprint = getCitationFingerprint(bibtex);
            if (!currentCitations.has(fingerprint)) {
              currentCitations.set(fingerprint, currentCitations.size + 1);
            }
          });
          return true;
        });

        const fingerprint = getCitationFingerprint(resolved.bibtex);
        const citationIndex = currentCitations.get(fingerprint) ?? currentCitations.size + 1;
        const citationFormat = formatEditorCitation(
          resolved.bibtex,
          citationStyle,
          citationIndex,
        );
        const formatted = citationFormat.formatted;
        const metadata = (resolved.document.metadata ?? {}) as Record<string, unknown>;
        const citationUrl =
          resolved.document.doi
            ? `https://doi.org/${resolved.document.doi}`
            : typeof metadata.url === 'string'
              ? metadata.url
              : typeof metadata.original_url === 'string'
                ? metadata.original_url
                : undefined;

        editor.focus();
        if (typeof selectionTo === 'number') {
          tiptapEditor?.chain().focus().setTextSelection(selectionTo).run();
        }
        const citation = {
          type: 'aiCitation',
          props: {
            citationId: resolved.document.id,
            base64,
            displayText: formatted.inText,
            bibliography: formatted.bibliography,
            style: citationFormat.style,
            url: citationUrl ?? '',
          },
        } as any;
        if (selectedText) editor.insertInlineContent([' ', citation, ' ']);
        else insertCitationsAtCaret(editor, [citation]);

        window.setTimeout(() => syncCitationStorageFromEditor(citationStyle), 0);

        setIsCitationPickerOpen(false);
      } catch (error) {
        console.error('Failed to insert AI editor citation:', error);
        toast.error('We could not build a citation for that source yet.');
      } finally {
        setIsInsertingCitation(false);
      }
    },
    [citationStyle, documentId, editor, syncCitationStorageFromEditor],
  );

  // ---------------------------------------------------------------- Assistant

  /** aiCitation items for BibTeX entries, numbered after the citations already in the document. */
  const buildCitationItems = useCallback(
    (entries: { bibtex: string; id?: string; url?: string }[]) => {
      const numbering = new Map<string, number>();
      editor.forEachBlock((block) => {
        (Array.isArray(block.content) ? block.content : []).forEach((item) => {
          if (!isAICitationInlineContent(item) || !item.props?.base64) return;
          const bibtex = getBibtexFromBase64(item.props.base64);
          if (!bibtex) return;
          const fingerprint = getCitationFingerprint(bibtex);
          if (!numbering.has(fingerprint)) numbering.set(fingerprint, numbering.size + 1);
        });
        return true;
      });
      const items: any[] = [];
      entries.forEach((entry) => {
        if (!entry.bibtex) return;
        const fingerprint = getCitationFingerprint(entry.bibtex);
        if (!numbering.has(fingerprint)) numbering.set(fingerprint, numbering.size + 1);
        const citationFormat = formatEditorCitation(entry.bibtex, citationStyle, numbering.get(fingerprint) as number);
        if (items.length) items.push(' ');
        items.push({
          type: 'aiCitation',
          props: {
            citationId: entry.id || fingerprint,
            base64: encodeBibtexToBase64(entry.bibtex),
            displayText: citationFormat.formatted.inText,
            bibliography: citationFormat.formatted.bibliography,
            style: citationFormat.style,
            url: entry.url || '',
          },
        });
      });
      return items;
    },
    [citationStyle, editor],
  );

  const makeSourceCitations = useCallback(
    (sources: AssistSource[]) =>
      buildCitationItems(
        sources.map((source) => ({
          bibtex: source.bibtex,
          id: source.library_document_id || source.doi || undefined,
          url: source.url || '',
        })),
      ),
    [buildCitationItems],
  );

  /** Citations at the cursor, or at the end of a paragraph (before its final full stop). */
  const insertCitationItems = useCallback(
    (items: any[], blockId?: string | null) => {
      if (!items.length) return;
      const block = blockId ? editor.getBlock(blockId) : null;
      if (block && Array.isArray(block.content)) {
        const content = [...(block.content as any[])];
        const last = content[content.length - 1];
        const ending = last?.type === 'text' ? /^([\s\S]*?)\s*([.!?])(\s*)$/.exec(last.text) : null;
        if (ending) {
          content[content.length - 1] = { ...last, text: ending[1] };
          content.push(' ', ...items, { type: 'text', text: ending[2], styles: last.styles || {} });
        } else {
          content.push(' ', ...items);
        }
        editor.updateBlock(block, { content } as any);
      } else {
        editor.focus();
        insertCitationsAtCaret(editor, items);
      }
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle), 0);
    },
    [citationStyle, editor, syncCitationStorageFromEditor],
  );

  const citePaper = useCallback(
    (paper: Paper, paragraph?: ParagraphTarget | null) => {
      if (!isWritingEnabled) {
        toast.error('Switch to Editing to add citations.');
        return;
      }
      const doi = paper.doi ? String(paper.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
      insertCitationItems(
        buildCitationItems([{ bibtex: paper.bibtex, id: doi || paper.id, url: paper.oa_url || (doi ? `https://doi.org/${doi}` : '') }]),
        paragraph?.blockId,
      );
      toast.success('Citation added');
    },
    [buildCitationItems, insertCitationItems, isWritingEnabled],
  );

  const citeSource = useCallback(
    (source: AssistSource) => {
      if (!isWritingEnabled) return;
      insertCitationItems(makeSourceCitations([source]));
    },
    [insertCitationItems, isWritingEnabled, makeSourceCitations],
  );

  const citeCustom = useCallback(
    (bibtex: string, url?: string) => insertCitationItems(buildCitationItems([{ bibtex, url }])),
    [buildCitationItems, insertCitationItems],
  );

  const savePaperToLibrary = useCallback(async (paper: Paper) => {
    try {
      await addPaperToLibrary(paper);
      setSavedPaperKeys((current) => new Set(current).add(paperKey(paper)));
      toast.success('Saved to your Library');
      return true;
    } catch (error) {
      toast.error((error as Error).message || 'Could not save to your Library.');
      return false;
    }
  }, []);

  /** "@" at the cursor opens the citation search (Library, papers, people). */
  const openCitationSearch = useCallback(() => {
    if (!isWritingEnabled) return;
    editor.focus();
    try {
      (editor as any).getExtension(SuggestionMenuExtension)?.openSuggestionMenu('@');
    } catch {
      setAssistantTab('papers');
    }
  }, [editor, isWritingEnabled]);

  const suggestedPaperQueries = useMemo(() => {
    const generic = /^(untitled.*|abstract|introduction|background|methods?|methodology|materials and methods|study design|data analysis|statistical analysis|results?|findings|discussion|conclusions?|limitations|future work|summary|references|bibliography|acknowledg\w*|appendix\w*|table of contents|literature review)$/i;
    const queries = [documentTitle, ...outlineItems.map((item) => item.title)]
      .map((value) => (value || '').replace(/^[\d.\s]+/, '').trim())
      // Leave out file names ("compat_test") and generic section names.
      .filter((value) => value.length > 3 && !/^[\w-]+\.\w{2,4}$|^[a-z0-9]+(_[a-z0-9]+)+$/i.test(value) && !generic.test(value));
    return Array.from(new Set(queries)).slice(0, 4);
  }, [documentTitle, outlineItems]);

  const getDocumentText = useCallback(
    () =>
      getEditorBlocks(editor)
        .map((block) => visibleText(block.content))
        .filter(Boolean)
        .join('\n\n'),
    [editor],
  );

  const commentBlockOrder = useMemo(() => {
    const order = new Map<string, number>();
    if (assistantTab !== 'comments') return order;
    let index = 0;
    editor.forEachBlock((block) => {
      order.set(block.id, index++);
      return true;
    });
    return order;
    // Recomputed when the panel opens or comments change; exact order between edits is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantTab, comments, editor]);

  /** Paragraphs for the AI reviewer (citations as placeholders; References left out). */
  const collectReviewBlocks = useCallback(
    (blockIds?: string[]) => {
      const managed = new Set(getManagedBibliographyBlocks(getEditorBlocks(editor)).map((block) => block.id));
      const out: { id: string; text: string; heading: boolean }[] = [];
      editor.forEachBlock((block) => {
        if (managed.has(block.id) || (blockIds && !blockIds.includes(block.id))) return true;
        if (!AI_BLOCK_TYPES.has(block.type) || !Array.isArray(block.content)) return true;
        const { text } = serializeInlineForAI(block.content);
        if (block.type === 'heading' || text.trim().length >= (blockIds ? 1 : 25)) {
          out.push({ id: block.id, text: text.slice(0, 12000), heading: block.type === 'heading' });
        }
        return true;
      });
      return out.slice(0, 2000);
    },
    [editor],
  );

  const runReview = useCallback(
    async (focus?: string, blockIds?: string[]) => {
      setAssistantTab('comments');
      const blocks = collectReviewBlocks(blockIds);
      if (!blocks.some((block) => !block.heading)) {
        setReviewRun({ running: false, error: 'There is nothing to review yet: write a few paragraphs first.', outOfCredits: false, lastAdded: null });
        return;
      }
      setReviewRun({ running: true, error: null, outOfCredits: false, lastAdded: null });
      try {
        const response = await reviewBlocks({ blocks, documentTitle, scope: blockIds ? 'block' : 'document', focus });
        const added = addAIReviewComments(
          response.comments.map((comment) => ({
            blockId: comment.blockId,
            quote: comment.quote,
            comment: comment.comment,
            severity: comment.severity,
            category: comment.category,
            suggestion: comment.suggestion,
          })),
        );
        setReviewRun({ running: false, error: null, outOfCredits: false, lastAdded: added });
        window.dispatchEvent(new CustomEvent('credits-updated'));
      } catch (error) {
        if (error instanceof AssistError && error.outOfCredits) {
          setReviewRun({ running: false, error: null, outOfCredits: true, lastAdded: null });
        } else {
          setReviewRun({ running: false, error: (error as Error).message || 'The review failed.', outOfCredits: false, lastAdded: null });
        }
      }
    },
    [addAIReviewComments, collectReviewBlocks, documentTitle],
  );

  // Accepted AI text goes into the version history as Videmak AI (after the copy is saved).
  const recordAIEdit = useCallback(() => {
    if (!documentId || !canEdit) return;
    window.setTimeout(() => {
      void flushBlocks(getEditorBlocks(editor))
        .then(() => saveAIVersion(documentId))
        .catch((error) => console.warn('Could not record the AI edit in version history', error));
    }, 300);
  }, [canEdit, documentId, editor, flushBlocks]);

  // ---------------------------------------------------------------- Review panel checks

  const [reviewMemory, setReviewMemory] = useState<ReviewMemory>({ ranAt: {} });
  const [checkRuns, setCheckRuns] = useState<Partial<Record<CheckId, CheckRun>>>({});
  const [commentFilter, setCommentFilter] = useState<CommentFilter>(null);
  useEffect(() => {
    setReviewMemory(documentId ? readReviewMemory(documentId) : { ranAt: {} });
    setCheckRuns({});
    setCommentFilter(null);
  }, [documentId]);
  const updateReviewMemory = useCallback(
    (update: (current: ReviewMemory) => ReviewMemory) =>
      setReviewMemory((current) => {
        const next = update(current);
        if (documentId) writeReviewMemory(documentId, next);
        return next;
      }),
    [documentId],
  );

  /** Every cited work in the document once, with what its stored BibTeX says. */
  const collectDocumentSources = useCallback(() => {
    const sources = new Map<string, { key: string; doi: string | null; title: string | null; year: string | null; label: string }>();
    editor.forEachBlock((block) => {
      for (const item of (Array.isArray(block.content) ? block.content : []) as any[]) {
        if (item?.type !== 'aiCitation') continue;
        const payload = item.props?.base64 ? getDecodedCitationPayload(item.props.base64) : null;
        const meta = payload?.bibtex ? parseBibtexToMetadata(payload.bibtex) : null;
        const doi = (meta?.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim() || null;
        const title = meta?.title?.trim() || null;
        const key = (doi || title || item.props?.citationId || item.props?.displayText || '').toLowerCase();
        if (!key || sources.has(key)) continue;
        sources.set(key, { key, doi, title, year: meta?.year || null, label: item.props?.displayText || title || key });
      }
      return true;
    });
    return [...sources.values()].slice(0, 150);
  }, [editor]);

  // The paragraphs of the last real selection, for checks run on "Selection".
  const [selectionBlockIds, setSelectionBlockIds] = useState<string[]>([]);
  useEffect(
    () =>
      editor.onSelectionChange(() => {
        let ids: string[] = [];
        try {
          const view = safeView(editor);
          if (view && !view.state.selection.empty) ids = (editor.getSelection()?.blocks || []).map((block) => block.id);
        } catch {
          ids = [];
        }
        setSelectionBlockIds((current) => (current.join() === ids.join() ? current : ids));
      }),
    [editor],
  );

  const runCheck = useCallback(
    async (check: CheckId, scope: 'document' | 'selection' = 'document') => {
      const scopeIds = scope === 'selection' && selectionBlockIds.length ? selectionBlockIds : null;
      setCheckRuns((current) => ({ ...current, [check]: { running: true, error: null } }));
      const done = (error: string | null) => setCheckRuns((current) => ({ ...current, [check]: { running: false, error } }));
      try {
        if (check === 'peer') {
          const text = scopeIds
            ? collectReviewBlocks(scopeIds).map((block) => block.text).join('\n\n')
            : getDocumentText();
          const result = await peerReview({ text, documentTitle });
          updateReviewMemory((current) => ({ ...current, peer: result, ranAt: { ...current.ranAt, peer: Date.now() } }));
        } else if (check === 'sources') {
          const sources = collectDocumentSources();
          if (!sources.length) {
            done('There are no citations in this document yet. Add some with Cite or @.');
            return;
          }
          const { results } = await sourceQuality(sources.map(({ label: _label, ...source }) => source));
          updateReviewMemory((current) => ({
            ...current,
            sources: { results, labels: Object.fromEntries(sources.map((source) => [source.key, source.label])) },
            ranAt: { ...current.ranAt, sources: Date.now() },
          }));
        } else {
          const blocks = collectReviewBlocks(scopeIds ?? undefined);
          if (!blocks.some((block) => !block.heading)) {
            done(scopeIds ? 'The selection has no text to check.' : 'There is nothing to check yet: write a few paragraphs first.');
            return;
          }
          const response = await reviewBlocks({
            blocks,
            documentTitle,
            scope: scopeIds ? 'block' : 'document',
            mode: check,
            tone: check === 'tone' ? reviewMemory.tone || TONES[0] : undefined,
          });
          // A new run replaces this check's open suggestions (only in the selection when it ran on one).
          comments
            .filter((comment) => comment.kind === 'ai-review' && comment.check === check && comment.status !== 'resolved')
            .filter((comment) => !scopeIds || (comment.blockId && scopeIds.includes(comment.blockId)))
            .forEach((comment) => deleteComment(comment.id));
          addAIReviewComments(
            response.comments.map((comment) => ({
              blockId: comment.blockId,
              quote: comment.quote,
              comment: comment.comment,
              severity: comment.severity,
              category: comment.category,
              suggestion: comment.suggestion,
              check,
            })),
          );
          updateReviewMemory((current) => ({ ...current, ranAt: { ...current.ranAt, [check]: Date.now() }, scope: { ...current.scope, [check]: scopeIds ? 'selection' : 'document' } }));
        }
        if (check === 'peer') updateReviewMemory((current) => ({ ...current, scope: { ...current.scope, peer: scopeIds ? 'selection' : 'document' } }));
        done(null);
        window.dispatchEvent(new CustomEvent('credits-updated'));
      } catch (error) {
        done(
          error instanceof AssistError && error.outOfCredits
            ? 'You are out of AI credit for this check. Upgrade to continue.'
            : (error as Error).message || 'The check failed. Try again.',
        );
      }
    },
    [addAIReviewComments, collectDocumentSources, collectReviewBlocks, comments, deleteComment, documentTitle, getDocumentText, reviewMemory.tone, selectionBlockIds, updateReviewMemory],
  );

  /** A check's fixes as tracked changes in the text (red removed, green added). */
  const showCheckInText = useCallback(
    (check: string) => {
      if (!isWritingEnabled) return 0;
      let applied = 0;
      const targets = comments.filter(
        (comment) => comment.kind === 'ai-review' && comment.check === check && comment.status !== 'resolved' && comment.suggestion && comment.blockId && comment.selectedText,
      );
      for (const comment of targets) {
        const view = safeView(editor);
        if (!view) break;
        const range = findTextInBlock(view.state, comment.blockId!, comment.selectedText!);
        if (!range) continue;
        replaceAsSuggestion(view, range.from, range.to, comment.suggestion!, AI_AUTHOR);
        resolveComment(comment.id, true);
        applied += 1;
      }
      if (!applied) toast('Nothing to show in the text: those passages have changed since the check.');
      return applied;
    },
    [comments, editor, isWritingEnabled, resolveComment],
  );
  const aiChangeIds = useMemo(() => suggestions.filter((item) => item.author === AI_AUTHOR).map((item) => item.id), [suggestions]);
  const resolveAIChanges = useCallback(
    (accept: boolean) => {
      const view = safeView(editor);
      if (!view || !aiChangeIds.length) return;
      resolveSuggestions(view, aiChangeIds, accept);
      // Accepted review fixes are AI edits too: keep them in the version history.
      if (accept) recordAIEdit();
    },
    [aiChangeIds, editor, recordAIEdit],
  );

  const acceptCommentSuggestion = useCallback(
    (comment: AIEditorComment) => {
      if (!comment.blockId || !comment.selectedText || !comment.suggestion || !isWritingEnabled) return;
      const view = safeView(editor);
      if (!view) return;
      const range = findTextInBlock(view.state, comment.blockId, comment.selectedText);
      if (!range) {
        toast.error('That text has changed since the review. Edit it by hand.');
        return;
      }
      if (isSuggesting) replaceAsSuggestion(view, range.from, range.to, comment.suggestion, AI_AUTHOR);
      else view.dispatch(view.state.tr.insertText(comment.suggestion, range.from, range.to));
      resolveComment(comment.id, true);
    },
    [editor, isSuggesting, isWritingEnabled, resolveComment],
  );

  const askAIInComment = useCallback(
    async (comment: AIEditorComment, question: string) => {
      const block = comment.blockId ? editor.getBlock(comment.blockId) : null;
      try {
        const response = await aiCommentReply({
          quote: comment.selectedText || '',
          blockText: block && Array.isArray(block.content) ? visibleText(block.content) : '',
          documentTitle,
          thread: [
            { author: comment.actorDisplayName, text: comment.text },
            ...(comment.replies || []).map((reply) => ({ author: reply.actorDisplayName, text: reply.text })),
          ],
          question,
        });
        addAIReply(comment.id, response.text);
        window.dispatchEvent(new CustomEvent('credits-updated'));
      } catch (error) {
        if (error instanceof AssistError && error.outOfCredits) setReviewRun((current) => ({ ...current, outOfCredits: true }));
        else toast.error((error as Error).message || 'Videmak AI could not reply.');
      }
    },
    [addAIReply, documentTitle, editor],
  );

  /** A chat answer goes in after the paragraph with the cursor, with its citations. */
  const insertChatAnswer = useCallback(
    async (message: ChatMessage) => {
      if (!isWritingEnabled) return;
      const parsed = await editor.tryParseMarkdownToBlocks(message.content);
      const blocks = replaceSourceMarkersInBlocks(parsed as any[], message.sources || [], makeSourceCitations);
      if (!blocks.length) return;
      let reference: any = null;
      try {
        reference = editor.getTextCursorPosition().block;
      } catch {
        reference = null;
      }
      const all = getEditorBlocks(editor);
      const managed = new Set(getManagedBibliographyBlocks(all).map((block) => block.id));
      if (!reference || managed.has(reference.id)) reference = [...all].reverse().find((block) => !managed.has(block.id)) || all[all.length - 1];
      editor.insertBlocks(blocks as any, reference, 'after');
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle), 0);
      toast.success('Inserted into the document');
    },
    [citationStyle, editor, isWritingEnabled, makeSourceCitations, syncCitationStorageFromEditor],
  );

  const applyRestoredVersion = useCallback(
    (version: DocumentVersionContent) => {
      const current = getEditorBlocks(editor);
      const next = version.blocks?.length ? version.blocks : [{ type: 'paragraph', content: [] }];
      editor.replaceBlocks(current.map((block) => block.id) as any, next as any);
      if (version.title && version.title !== documentTitle) updateTitle(version.title);
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle, { force: true }), 0);
    },
    [citationStyle, documentTitle, editor, syncCitationStorageFromEditor, updateTitle],
  );

  // Realtime documents live in the CRDT; the stored block copy (what version history and
  // server exports read) is refreshed every two minutes while someone edits, and on leaving.
  const versionCheckpointRef = useRef({ dirty: false, saving: false });
  const saveVersionCheckpoint = useCallback(async () => {
    const state = versionCheckpointRef.current;
    if (!isUsingCrdt || !canEdit || state.saving) return;
    state.saving = true;
    try {
      await flushBlocks(getEditorBlocks(editor));
      state.dirty = false;
    } catch (error) {
      console.warn('Could not save the document copy for version history', error);
    } finally {
      state.saving = false;
    }
  }, [canEdit, editor, flushBlocks, isUsingCrdt]);
  useEffect(() => {
    if (!isUsingCrdt || !canEdit) return undefined;
    const unsubscribe = editor.onChange(() => {
      versionCheckpointRef.current.dirty = true;
    });
    const timer = window.setInterval(() => {
      if (versionCheckpointRef.current.dirty) void saveVersionCheckpoint();
    }, 2 * 60 * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden' && versionCheckpointRef.current.dirty) void saveVersionCheckpoint();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsubscribe?.();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [canEdit, editor, isUsingCrdt, saveVersionCheckpoint]);


  // Autocomplete settings: sources and citation filters, remembered in this browser.
  const [autocompleteSettings, setAutocompleteSettings] = useState<AutocompleteSettings>(DEFAULT_AUTOCOMPLETE_SETTINGS);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('videmak_autocomplete_settings') || 'null');
      if (saved && typeof saved === 'object') setAutocompleteSettings({ ...DEFAULT_AUTOCOMPLETE_SETTINGS, ...saved });
    } catch {
      // Defaults.
    }
  }, []);
  const changeAutocompleteSettings = useCallback((next: AutocompleteSettings) => {
    setAutocompleteSettings(next);
    try { window.localStorage.setItem('videmak_autocomplete_settings', JSON.stringify(next)); } catch { /* storage blocked */ }
  }, []);

  const autocompleteState = useAutocomplete({
    editor,
    onAccepted: recordAIEdit,
    settings: autocompleteSettings,
    onTitle: (title) => {
      if (!documentTitle.trim() || /^untitled/i.test(documentTitle.trim())) updateTitle(title);
    },
    enabled: areAIWritingSuggestionsEnabled && isWritingEnabled && !isMobile && !isSuggesting && !autocompleteOutOfCredits,
    documentTitle,
    makeCitations: makeSourceCitations,
    onOutOfCredits: () => setAutocompleteOutOfCredits(true),
  });
  editorPluginHooks.current = { ...editorPluginHooks.current, autocomplete: autocompleteState.pluginHandlers };

  useEffect(() => {
    const resume = () => setAutocompleteOutOfCredits(false);
    window.addEventListener('credits-updated', resume);
    return () => window.removeEventListener('credits-updated', resume);
  }, []);

  // Inline equations: click one to edit it; Insert > Inline equation adds one at the cursor.
  const openInlineEquation = useCallback(() => {
    const view = safeView(editor);
    if (!view || !isWritingEnabled) return;
    const coords = view.coordsAtPos(view.state.selection.from);
    setMathEditor({ anchor: new DOMRect(coords.left, coords.top, 1, coords.bottom - coords.top), latex: '', pos: null });
  }, [editor, isWritingEnabled]);

  const handleMathClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isWritingEnabled) return;
      const target = (event.target as HTMLElement).closest('[data-inline-content-type="aiMath"]') as HTMLElement | null;
      const view = safeView(editor);
      if (!target || !view) return;
      try {
        const pos = findInlineNodePos(view, target, 'aiMath');
        const node = pos === null ? null : view.state.doc.nodeAt(pos);
        if (pos === null || node?.type.name !== 'aiMath') return;
        setMathEditor({ anchor: target.getBoundingClientRect(), latex: String(node.attrs.latex || ''), pos });
      } catch {
        /* the node moved */
      }
    },
    [editor, isWritingEnabled],
  );

  const saveInlineEquation = useCallback(
    (latex: string) => {
      const view = safeView(editor);
      const editing = mathEditor;
      setMathEditor(null);
      if (!view || !editing) return;
      if (editing.pos === null) {
        if (latex) editor.insertInlineContent([{ type: 'aiMath', props: { latex, displayMode: 'false' } } as any, ' ']);
        return;
      }
      const node = view.state.doc.nodeAt(editing.pos);
      if (node?.type.name !== 'aiMath') return;
      view.dispatch(
        latex
          ? view.state.tr.setNodeMarkup(editing.pos, undefined, { ...node.attrs, latex })
          : view.state.tr.delete(editing.pos, editing.pos + node.nodeSize),
      );
    },
    [editor, mathEditor],
  );

  // Citation card actions (click a citation): narrative form, edit, save to Library.
  const updateCitationNode = useCallback(
    (pos: number, patch: Record<string, string>) => {
      const view = safeView(editor);
      const node = view?.state.doc.nodeAt(pos);
      if (!view || node?.type.name !== 'aiCitation') return;
      // Clearing the saved style makes the next sync format this citation again.
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, style: '', ...patch }));
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle, { force: true }), 0);
    },
    [citationStyle, editor, syncCitationStorageFromEditor],
  );

  const handleCitationNarrative = useCallback(
    (_metadata: CitationMetadata, target: HTMLElement | null) => {
      const view = safeView(editor);
      if (!view || !target || !isWritingEnabled) return;
      const pos = findInlineNodePos(view, target, 'aiCitation');
      if (pos === null) return;
      const node = view.state.doc.nodeAt(pos);
      updateCitationNode(pos, { mode: node?.attrs.mode === 'narrative' ? '' : 'narrative' });
    },
    [editor, isWritingEnabled, updateCitationNode],
  );

  const handleCitationEdit = useCallback(
    (metadata: CitationMetadata, target: HTMLElement | null) => {
      const view = safeView(editor);
      if (!view || !target || !isWritingEnabled) return;
      const pos = findInlineNodePos(view, target, 'aiCitation');
      const node = pos === null ? null : view.state.doc.nodeAt(pos);
      if (pos === null || !node) return;
      setCitationEditor({ anchor: target.getBoundingClientRect(), pos, title: metadata.title, attrs: node.attrs });
    },
    [editor, isWritingEnabled],
  );

  const handleCitationSave = useCallback(
    (metadata: CitationMetadata) => {
      const doi = metadata.doi ? metadata.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
      void savePaperToLibrary({
        id: '',
        title: metadata.title,
        authors: metadata.authors.map((name) => ({ name })),
        year: Number.parseInt(metadata.year, 10) || null,
        doi: doi || null,
        oa_url: metadata.url || null,
        abstract: metadata.abstract || null,
        bibtex: '',
      });
    },
    [savePaperToLibrary],
  );

  const lookupCitation = useCallback(async (metadata: CitationMetadata) => {
    if (!metadata.doi) return null;
    const paper = await lookupPaper(metadata.doi);
    return {
      citedBy: paper.cited_by_count ?? undefined,
      isOpenAccess: paper.is_open_access ?? undefined,
      abstract: metadata.abstract || paper.abstract || undefined,
      journal: metadata.journal || paper.source_name || undefined,
    };
  }, []);

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          ...getDefaultReactSlashMenuItems(editor),
          {
            title: 'Citation',
            subtext: 'Cite from your Library or 250M+ papers',
            aliases: ['cite', 'reference', 'source'],
            group: 'Academic',
            icon: <LuQuote size={18} />,
            onItemClick: () => window.setTimeout(openCitationSearch, 0),
          },
          {
            title: 'Equation',
            subtext: 'A TeX equation on its own line',
            aliases: ['math', 'latex', 'tex', 'formula'],
            group: 'Academic',
            icon: <LuSigma size={18} />,
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'equation', props: { latex: '' } } as any),
          },
          {
            title: 'Inline equation',
            subtext: 'TeX inside the sentence',
            aliases: ['math', 'latex', 'inline'],
            group: 'Academic',
            icon: <LuSigma size={18} />,
            onItemClick: () => window.setTimeout(openInlineEquation, 0),
          },
          {
            title: 'Table of contents',
            subtext: 'The headings of the document',
            aliases: ['toc', 'contents', 'outline'],
            group: 'Academic',
            icon: <LuTableOfContents size={18} />,
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'tableOfContents' } as any),
          },
        ],
        query,
      ),
    [editor, openCitationSearch, openInlineEquation],
  );

  // A cursor suggestion's card sits under the paragraph it continues, inside the scrolling page.
  useLayoutEffect(() => {
    if (!activeAISuggestion || isStartWritingFlow) {
      setSuggestionAnchor(null);
      return undefined;
    }
    const place = () => {
      const container = documentScrollContainerRef.current;
      const blockId = aiSuggestionAnchorBlockIdRef.current;
      const element = blockId ? (container?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null) : null;
      if (!container || !element) {
        setSuggestionAnchor(null);
        return;
      }
      const box = container.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      setSuggestionAnchor({ top: rect.bottom - box.top + container.scrollTop + 8, left: rect.left - box.left + container.scrollLeft, width: rect.width });
    };
    place();
    const frame = window.requestAnimationFrame(() => suggestionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    // Panels opening, zoom and edits move the paragraph: follow it.
    const observer = new ResizeObserver(place);
    if (documentScrollContainerRef.current) observer.observe(documentScrollContainerRef.current);
    if (editorSurfaceRef.current) observer.observe(editorSurfaceRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeAISuggestion, isStartWritingFlow]);

  const syncCursorActionBar = useCallback(() => {
    const root = editorSurfaceRef.current;
    if (!root) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const isEditorFocused = Boolean(activeElement && root.contains(activeElement));
    // A selection gets the formatting toolbar; the caret pill is for a blinking cursor only.
    const caretNode = window.getSelection()?.anchorNode ?? null;
    const isCaret = window.getSelection()?.isCollapsed !== false && !root.querySelector('.bn-suggestion-decorator')
      // Not in table cells (the pill would sit on the table's handles) or the reference list.
      && !(caretNode instanceof Element ? caretNode : caretNode?.parentElement)?.closest('table, [data-ce-role^="bibliography"]');
    // The caret pill ("AI suggest | + Cite"): with Autocomplete
    // on it follows the cursor; it steps aside while autocomplete ghost text is showing.
    const shouldShow =
      !isMobile &&
      areAIWritingSuggestionsEnabled &&
      isWritingEnabled &&
      isEditorFocused &&
      isCaret &&
      !activeAISuggestion &&
      !isCitationPickerOpen &&
      !isStartWritingFlow;

    const hide = () =>
      setCursorActionBar((current) =>
        current.loading || !current.visible ? current : { ...current, visible: false },
      );

    if (!shouldShow) {
      hide();
      return;
    }

    const nextPosition = getCursorActionPosition(root, editor);
    // Hidden once the caret scrolls out of the document view, so the bar never
    // floats over the header or the toolbar.
    const viewport = documentScrollContainerRef.current?.getBoundingClientRect();
    if (!nextPosition || (viewport && (nextPosition.top < viewport.top || nextPosition.top > viewport.bottom - 24))) {
      hide();
      return;
    }

    setCursorActionBar((current) =>
      current.visible && current.position.top === nextPosition.top && current.position.left === nextPosition.left
        ? current
        : { ...current, visible: true, position: nextPosition },
    );
  }, [activeAISuggestion, areAIWritingSuggestionsEnabled, editor, isCitationPickerOpen, isMobile, isStartWritingFlow, isWritingEnabled]);

  useEffect(() => {
    syncCursorActionBar();
  }, [syncCursorActionBar]);

  useEffect(() => {
    const syncSelectedReviewRange = () => {
      const nextRange = resolveSelectedReviewRange();
      setSelectedReviewRange((current) => (sameReviewRange(current, nextRange) ? current : nextRange));
      if (!nextRange) {
        setReviewContextMenu(null);
      }
    };

    const unsubscribeSelection = editor.onSelectionChange(() => {
      syncCursorActionBar();
      syncSelectedReviewRange();
      scheduleActiveBlockReview();
    });
    const unsubscribeChange = editor.onChange(() => {
      syncCursorActionBar();
      syncCitationStorageFromEditor(citationStyle);
      syncSelectedReviewRange();
      scheduleActiveBlockReview();
    }, true);
    const handleWindowSelectionChange = () => {
      syncCursorActionBar();
      syncSelectedReviewRange();
    };
    const handleResize = () => {
      syncCursorActionBar();
    };
    const scrollContainer = documentScrollContainerRef.current;

    document.addEventListener('selectionchange', handleWindowSelectionChange);
    window.addEventListener('resize', handleResize);
    scrollContainer?.addEventListener('scroll', handleResize, { passive: true });

    return () => {
      unsubscribeSelection?.();
      unsubscribeChange?.();
      document.removeEventListener('selectionchange', handleWindowSelectionChange);
      window.removeEventListener('resize', handleResize);
      scrollContainer?.removeEventListener('scroll', handleResize);
    };
  }, [
    citationStyle,
    editor,
    resolveSelectedReviewRange,
    scheduleActiveBlockReview,
    syncCitationStorageFromEditor,
    syncCursorActionBar,
  ]);

  const handlePrintDocument = useCallback(() => {
    if (typeof window === 'undefined') return;
    // The title names the PDF when the print is saved; the tab gets its own back afterwards.
    const tabTitle = document.title;
    document.title = documentTitle || 'Document';
    window.print();
    document.title = tabTitle;
  }, [documentTitle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        handlePrintDocument();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrintDocument]);

  const handleCopyShareLink = useCallback(async () => {
    if (!documentSnapshot?.share.isLinkSharingEnabled || !shareLink) {
      setIsShareDialogOpen(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(shareLink);
    } catch (error) {
      console.error('Failed to copy ai-editor share link:', error);
    }
  }, [documentSnapshot?.share.isLinkSharingEnabled, shareLink]);

  const handleToggleDocumentStar = useCallback(() => {
    if (!documentId) {
      return;
    }

    const starredIds = loadStarredDocumentIds();
    const nextStarred = !starredIds.has(documentId);
    if (nextStarred) starredIds.add(documentId);
    else starredIds.delete(documentId);
    persistStarredDocumentIds(starredIds);
    setIsDocumentStarred(nextStarred);
    toast.success(nextStarred ? 'Starred: it stays at the top of your documents' : 'Removed from starred');
  }, [documentId]);

  const handleOpenComments = useCallback(
    (withSelection = false) => {
      if (!canComment && comments.length === 0) {
        return;
      }

      const nextContext: {
        selectedText?: string;
        blockId?: string | null;
      } = {};

      if (withSelection) {
        const selectedText = editor.getSelectedText().trim();
        const blockId = session
          ? getActiveCursorBlockId(editor, {
              ...session,
              role: effectiveRole,
              lastSeenAt: Date.now(),
              isCurrentUser: true,
            })
          : null;

        if (selectedText) {
          nextContext.selectedText = selectedText;
        }
        nextContext.blockId = blockId;
      }

      setCommentDraftContext(nextContext);
      setActiveCommentId(null);
      setIsCommentsDialogOpen(true);
    },
    [canComment, comments.length, editor, effectiveRole, session],
  );

  // ---------------------------------------------------------------- paragraph ✨ menu

  const unfreezeSideMenu = useUnfreezeSideMenu(editor);
  const closeBlockAI = useCallback(() => {
    setBlockAI(null);
    unfreezeSideMenu();
  }, [unfreezeSideMenu]);
  const openBlockAI = useCallback((blockId: string, anchor: DOMRect) => setBlockAI({ blockId, anchor, mode: 'menu' }), []);
  /** Phones have no hover side menu: the toolbar's ✨ opens the menu for the paragraph with the cursor. */
  const openBlockAIForCursor = useCallback(() => {
    let block: any = null;
    try {
      block = editor.getTextCursorPosition().block;
    } catch {
      block = null;
    }
    if (!block || !AI_BLOCK_TYPES.has(block.type)) return;
    const element = editorSurfaceRef.current?.querySelector(`[data-id="${block.id}"] .bn-block-content`) as HTMLElement | null;
    setBlockAI({ blockId: block.id, anchor: element?.getBoundingClientRect() ?? new DOMRect(16, 120, 1, 1), mode: 'menu' });
  }, [editor]);

  const handleBlockAIAction = useCallback(
    (action: BlockAIAction) => {
      const block = blockAI ? editor.getBlock(blockAI.blockId) : null;
      if (!blockAI || !block) {
        closeBlockAI();
        return;
      }
      const text = visibleText(block.content);
      if (action === 'edit') {
        const element = editorSurfaceRef.current?.querySelector(`[data-id="${block.id}"] .bn-block-content`) as HTMLElement | null;
        setBlockAI({ blockId: block.id, anchor: element?.getBoundingClientRect() || blockAI.anchor, mode: 'edit' });
        return;
      }
      closeBlockAI();
      if (action === 'citations') {
        setPapersParagraph({ blockId: block.id, text });
        setAssistantTab('papers');
      } else if (action === 'chat') {
        setChatContext({ text, blockId: block.id });
        setAssistantTab('chat');
      } else if (action === 'comment') {
        editor.setTextCursorPosition(block, 'end');
        handleOpenComments(true);
      } else if (action === 'review') {
        void runReview(undefined, [block.id]);
      }
    },
    [blockAI, closeBlockAI, editor, handleOpenComments, runReview],
  );

  const applyAIEdit = useCallback(
    (result: AIEditResult, mode: 'replace' | 'below') => {
      const block = blockAI ? editor.getBlock(blockAI.blockId) : null;
      if (!block) {
        closeBlockAI();
        return;
      }
      const paragraphs = aiTextToInline(result.text, result.items, result.sources, makeSourceCitations);
      if (!paragraphs.length) {
        closeBlockAI();
        return;
      }
      const view = safeView(editor);
      const plainRewrite = paragraphs.length === 1 && !/\[\[|\[S\d/.test(result.text);
      if (mode === 'replace' && isSuggesting && view && plainRewrite) {
        // Suggesting mode: the rewrite becomes a tracked change of the paragraph's text.
        let range: { from: number; to: number } | null = null;
        view.state.doc.descendants((node, pos) => {
          if (range) return false;
          if (node.type.name === 'blockContainer' && node.attrs.id === block.id) {
            const content = node.firstChild;
            if (content) range = { from: pos + 2, to: pos + 2 + content.content.size };
            return false;
          }
          return true;
        });
        if (range) {
          replaceAsSuggestion(view, (range as { from: number; to: number }).from, (range as { from: number; to: number }).to, result.text.trim(), AI_AUTHOR);
          closeBlockAI();
          return;
        }
      }
      const extra = paragraphs.slice(1).map((content) => ({ type: 'paragraph', content }));
      if (mode === 'replace') {
        editor.updateBlock(block, { content: paragraphs[0] } as any);
        if (extra.length) editor.insertBlocks(extra as any, block, 'after');
      } else {
        editor.insertBlocks(paragraphs.map((content) => ({ type: 'paragraph', content })) as any, block, 'after');
      }
      window.setTimeout(() => syncCitationStorageFromEditor(citationStyle), 0);
      closeBlockAI();
    },
    [blockAI, citationStyle, closeBlockAI, editor, isSuggesting, makeSourceCitations, syncCitationStorageFromEditor],
  );

  const blockAITarget = blockAI ? editor.getBlock(blockAI.blockId) : null;

  const blockAIContext = useMemo(() => {
    if (!blockAI || blockAI.mode !== 'edit') return { before: '', after: '' };
    const blocks = getEditorBlocks(editor);
    const index = blocks.findIndex((block) => block.id === blockAI.blockId);
    return {
      before: blocks.slice(Math.max(0, index - 3), Math.max(0, index)).map((block) => visibleText(block.content)).join('\n\n'),
      after: index >= 0 ? blocks.slice(index + 1, index + 3).map((block) => visibleText(block.content)).join('\n\n') : '',
    };
  }, [blockAI, editor]);

  const handleOpenCommentThread = useCallback(
    (blockId: string) => {
      const threadComment =
        comments.find((comment) => comment.blockId === blockId && comment.status !== 'resolved') ??
        comments.find((comment) => comment.blockId === blockId);
      setCommentDraftContext({
        blockId,
        selectedText: threadComment?.selectedText,
      });
      setActiveCommentId(threadComment?.id ?? null);
      setIsCommentsDialogOpen(true);
    },
    [comments],
  );

  useEffect(() => {
    const root = editorSurfaceRef.current;
    if (!root) {
      setCommentAnchors((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let rafId: number | null = null;

    const syncAnchors = () => {
      const threads = new Map<
        string,
        {
          count: number;
          primaryComment: typeof comments[number];
        }
      >();
      comments.forEach((comment) => {
        if (comment.blockId && comment.status !== 'resolved') {
          const existing = threads.get(comment.blockId);
          if (!existing) {
            threads.set(comment.blockId, {
              count: 1,
              primaryComment: comment,
            });
            return;
          }

          const nextPrimary =
            comment.createdAt > existing.primaryComment.createdAt ? comment : existing.primaryComment;
          threads.set(comment.blockId, {
            count: existing.count + 1,
            primaryComment: nextPrimary,
          });
        }
      });

      if (threads.size === 0) {
        setCommentAnchors((prev) => (prev.length === 0 ? prev : []));
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const nextAnchors = Array.from(threads.entries())
        .map(([blockId, thread]) => {
          const blockElement = root.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
          if (!blockElement) {
            return null;
          }

          const blockRect = blockElement.getBoundingClientRect();
          return {
            blockId,
            count: thread.count,
            top: blockRect.top - rootRect.top + root.scrollTop + 6,
            commentId: thread.primaryComment.id,
            actorDisplayName: thread.primaryComment.actorDisplayName,
            actorSessionId: thread.primaryComment.actorSessionId ?? '',
            text: thread.primaryComment.text,
            selectedText: thread.primaryComment.selectedText,
            createdAt: thread.primaryComment.createdAt,
            status: thread.primaryComment.status ?? 'open',
            replies: (thread.primaryComment.replies ?? []).map((r) => ({
              id: r.id,
              actorDisplayName: r.actorDisplayName,
              text: r.text,
              createdAt: r.createdAt,
            })),
          };
        })
        .filter(Boolean) as typeof commentAnchors;

      setCommentAnchors((prev) => {
        if (prev.length !== nextAnchors.length) return nextAnchors;
        const changed = prev.some(
          (a, i) =>
            a.blockId !== nextAnchors[i].blockId ||
            a.count !== nextAnchors[i].count ||
            a.commentId !== nextAnchors[i].commentId ||
            a.text !== nextAnchors[i].text ||
            a.replies.length !== nextAnchors[i].replies.length ||
            Math.abs(a.top - nextAnchors[i].top) > 0.5,
        );
        return changed ? nextAnchors : prev;
      });
    };

    syncAnchors();

    const debouncedSync = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncAnchors();
      });
    };

    const observer = new MutationObserver(debouncedSync);
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', syncAnchors);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', syncAnchors);
    };
  }, [comments, documentSnapshot?.blocks]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    if (!root) {
      setReviewAnchors((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const entries = Object.entries(reviewIssuesByBlockId).filter(([, issues]) => issues.length > 0);
    if (entries.length === 0) {
      setReviewAnchors((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const nextAnchors: AIEditorReviewAnchor[] = [];
    entries.forEach(([blockId, issues]) => {
      const blockElement = root.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
      if (!blockElement || issues.length === 0) return;

      issues.forEach((issue) => {
        const range = createOffsetHighlightRange(
          blockElement,
          issue.visible_start_offset ?? issue.start_offset,
          issue.visible_end_offset ?? issue.end_offset,
        );
        let top: number;
        let left = 0;
        if (range) {
          const rangeRect = range.getBoundingClientRect();
          top = rangeRect.bottom - rootRect.top + root.scrollTop;
          left = rangeRect.left - rootRect.left;
        } else {
          const blockRect = blockElement.getBoundingClientRect();
          top = blockRect.top - rootRect.top + root.scrollTop + 8;
        }
        nextAnchors.push({
          issueId: issue.id,
          blockId,
          top,
          left,
          category: issue.category,
          severity: issue.severity,
          title: issue.title,
          explanation: issue.explanation,
          original_text: issue.original_text,
          suggested_text: issue.suggested_text,
          start_offset: issue.start_offset,
          end_offset: issue.end_offset,
        });
      });
    });

    setReviewAnchors(nextAnchors);
  }, [reviewIssuesByBlockId, documentSnapshot?.blocks]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    const cssApi = (globalThis as any).CSS;
    const HighlightCtor = (globalThis as any).Highlight;

    if (!root || !cssApi?.highlights || !HighlightCtor) {
      return;
    }

    const openComments = comments.filter(
      (comment) => comment.status !== 'resolved' && comment.blockId && comment.selectedText?.trim(),
    );
    const baseRanges: Range[] = [];
    const activeRanges: Range[] = [];

    openComments.forEach((comment) => {
      const blockElement = root.querySelector(`[data-id="${comment.blockId}"]`) as HTMLElement | null;
      if (!blockElement || !comment.selectedText) {
        return;
      }

      const range = createCommentHighlightRange(blockElement, comment.selectedText);
      if (!range) {
        return;
      }

      if (comment.id === activeCommentId) {
        activeRanges.push(range);
      } else {
        baseRanges.push(range);
      }
    });

    cssApi.highlights.delete('ai-editor-comment-highlight');
    cssApi.highlights.delete('ai-editor-comment-highlight-active');

    if (baseRanges.length > 0) {
      cssApi.highlights.set('ai-editor-comment-highlight', new HighlightCtor(...baseRanges));
    }
    if (activeRanges.length > 0) {
      cssApi.highlights.set('ai-editor-comment-highlight-active', new HighlightCtor(...activeRanges));
    }

    return () => {
      cssApi.highlights.delete('ai-editor-comment-highlight');
      cssApi.highlights.delete('ai-editor-comment-highlight-active');
    };
  }, [activeCommentId, comments, documentSnapshot?.blocks]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    const cssApi = (globalThis as any).CSS;
    const HighlightCtor = (globalThis as any).Highlight;

    if (!root || !cssApi?.highlights || !HighlightCtor) {
      return;
    }

    const baseRanges: Range[] = [];
    const activeRanges: Range[] = [];

    Object.entries(reviewIssuesByBlockId).forEach(([blockId, issues]) => {
      const blockElement = root.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
      if (!blockElement) {
        return;
      }

      issues.forEach((issue) => {
        const range = createOffsetHighlightRange(
          blockElement,
          issue.visible_start_offset ?? issue.start_offset,
          issue.visible_end_offset ?? issue.end_offset,
        );
        if (!range) {
          return;
        }

        if (issue.id === activeReviewIssueId) {
          activeRanges.push(range);
        } else {
          baseRanges.push(range);
        }
      });
    });

    cssApi.highlights.delete('ai-editor-review-highlight');
    cssApi.highlights.delete('ai-editor-review-highlight-active');

    if (baseRanges.length > 0) {
      cssApi.highlights.set('ai-editor-review-highlight', new HighlightCtor(...baseRanges));
    }
    if (activeRanges.length > 0) {
      cssApi.highlights.set('ai-editor-review-highlight-active', new HighlightCtor(...activeRanges));
    }

    return () => {
      cssApi.highlights.delete('ai-editor-review-highlight');
      cssApi.highlights.delete('ai-editor-review-highlight-active');
    };
  }, [activeReviewIssueId, reviewIssuesByBlockId, documentSnapshot?.blocks]);

  useEffect(() => {
    const root = editorSurfaceRef.current;
    if (!root) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('[data-review-card]')) return;

      const blockEl = target.closest('[data-id]') as HTMLElement | null;
      if (!blockEl) {
        setActiveReviewIssueId(null);
        return;
      }

      const blockId = blockEl.getAttribute('data-id');
      const issues = blockId ? (reviewIssuesByBlockId[blockId] ?? []) : [];
      if (issues.length === 0) {
        setActiveReviewIssueId(null);
        return;
      }

      const clickOffset = getClickTextOffset(blockEl, e.clientX, e.clientY);
      if (clickOffset === null) {
        setActiveReviewIssueId(null);
        return;
      }

      const hit = issues.find(
        (issue) =>
          clickOffset >= (issue.visible_start_offset ?? issue.start_offset) &&
          clickOffset < (issue.visible_end_offset ?? issue.end_offset),
      );

      if (hit) {
        setActiveReviewIssueId(hit.id);
      } else {
        setActiveReviewIssueId(null);
      }
    };

    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
  }, [reviewIssuesByBlockId]);

  const thesisImportPhase1Ref = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importAttempt, setImportAttempt] = useState(0);
  useEffect(() => {
    if (thesisImportPhase1Ref.current) return;
    if (!mounted) return;
    const from = searchParams.get('from');
    if (from !== 'thesis-manuscript') return;
    if (documentId) return;

    const html = sessionStorage.getItem('thesis-manuscript-editor-content') || localStorage.getItem('thesis-manuscript-editor-content');
    const markdown = sessionStorage.getItem('thesis-manuscript-editor-markdown') || localStorage.getItem('thesis-manuscript-editor-markdown');
    if (!html && !markdown) return;

    thesisImportPhase1Ref.current = true;
    const title = sessionStorage.getItem('thesis-manuscript-editor-title') || localStorage.getItem('thesis-manuscript-editor-title') || 'Manuscript';
    const nextDocumentId = createDocument();
    trackAIEditorDocumentCreated({ source: 'thesis_manuscript_import' });
    const sid = provider.getSession().sessionId;
    provider.updateTitle(nextDocumentId, sid, title);
    sessionStorage.setItem('thesis-manuscript-pending-doc', nextDocumentId);
    router.replace(`${editorPath()}?doc=${nextDocumentId}`);
  }, [mounted, searchParams, documentId, createDocument, provider, router]);

  const thesisImportPhase2Ref = useRef(false);
  useEffect(() => {
    if (thesisImportPhase2Ref.current) return;
    if (!documentId || !editor || documentSnapshot?.id !== documentId) return;
    if (isAuthenticated && !crdtCollaboration.isReady) return;

    const pendingDoc = sessionStorage.getItem('thesis-manuscript-pending-doc');
    if (!pendingDoc || pendingDoc !== documentId) return;

    thesisImportPhase2Ref.current = true;
    const acknowledge = captureEditorHandoff('thesis-manuscript');

    const html = sessionStorage.getItem('thesis-manuscript-editor-content') || localStorage.getItem('thesis-manuscript-editor-content');
    const markdown = sessionStorage.getItem('thesis-manuscript-editor-markdown') || localStorage.getItem('thesis-manuscript-editor-markdown');
    const importedStyle = sessionStorage.getItem('thesis-manuscript-editor-citation-style') || localStorage.getItem('thesis-manuscript-editor-citation-style') || citationStyle;
    const importedTitle = sessionStorage.getItem('thesis-manuscript-editor-title') || localStorage.getItem('thesis-manuscript-editor-title') || documentSnapshot.title || '';
    const importedAuthors = sessionStorage.getItem('thesis-manuscript-editor-authors') || localStorage.getItem('thesis-manuscript-editor-authors') || '';

    if (!html && !markdown) return;

    void (async () => { try {
      await loadCslStyle(importedStyle);
      let parsed: Block<any, any, any>[] = [];

      let prepared = html || '';
      if (typeof window !== 'undefined' && prepared.includes('citation-token')) {
        const tmpDoc = new DOMParser().parseFromString(`<div>${prepared}</div>`, 'text/html');
        tmpDoc.querySelectorAll('span.citation-token[data-citation]').forEach((span) => {
          span.setAttribute('data-inline-content-type', 'aiCitation');
          const b64 = span.getAttribute('data-citation') || '';
          if (b64) {
            span.setAttribute('data-base64', b64);
          }
          if (!span.getAttribute('data-display-text')) {
            span.setAttribute('data-display-text', span.textContent || '(Citation)');
          }
          if (!span.getAttribute('data-style')) {
            span.setAttribute('data-style', importedStyle);
          }
        });
        prepared = tmpDoc.body.firstElementChild?.innerHTML || prepared;
      }
      if (prepared) {
        const preprocessed = preprocessRichDocumentHtml(prepared);
        parsed = editor.tryParseHTMLToBlocks(preprocessed);
      }
      if (!prepared && markdown?.trim()) {
        const editorWithMarkdown = editor as typeof editor & {
          tryParseMarkdownToBlocks?: (value: string) => Block<any, any, any>[];
        };
        parsed = editorWithMarkdown.tryParseMarkdownToBlocks?.(markdown) || [];
      }
      if (!parsed.length) throw new Error('The manuscript could not be imported. Its original export has been retained.');
      const normalized = normalizeImportedManuscriptBlocks(parsed, importedTitle, importedAuthors);
      editor.replaceBlocks(editor.document, normalized as any);
      syncCitationStorageFromEditor(importedStyle);
      window.localStorage.setItem(`${AI_EDITOR_CITATION_STYLE_STORAGE_KEY}:${documentId}`, importedStyle);
      setCitationStyle(importedStyle);
      if (isUsingCrdt) await crdtCollaboration.flush();
      await flushBlocks(getEditorBlocks(editor));
      acknowledge();
      setImportError(null);
      moduleAnalytics.completed('ai_editor', 'import', {source: 'thesis-manuscript'});
    } catch (err) {
      console.error('Failed to seed manuscript content into editor:', err);
      setImportError('The manuscript import could not finish. The original export is retained. Retry once your connection is available.');
      moduleAnalytics.failed('ai_editor', 'import', 'handoff_failed', undefined, {source: 'thesis-manuscript'});
    } })();
  }, [documentId, editor, documentSnapshot, citationStyle, syncCitationStorageFromEditor, isAuthenticated, crdtCollaboration.isReady, crdtCollaboration.flush, isUsingCrdt, flushBlocks, importAttempt]);

  // ---- Research Agent → AI Editor import (phase 1: create doc) ----
  const researchImportPhase1Ref = useRef(false);
  useEffect(() => {
    if (researchImportPhase1Ref.current) return;
    if (!mounted) return;
    const from = searchParams.get('from');
    if (from !== 'research-agent') return;
    if (documentId) return;

    const html = sessionStorage.getItem('research-agent-editor-content') || localStorage.getItem('research-agent-editor-content');
    const markdown = sessionStorage.getItem('research-agent-editor-markdown') || localStorage.getItem('research-agent-editor-markdown');
    if (!html && !markdown) return;

    researchImportPhase1Ref.current = true;
    const title = sessionStorage.getItem('research-agent-editor-title') || localStorage.getItem('research-agent-editor-title') || 'Research Document';
    const nextDocumentId = createDocument();
    trackAIEditorDocumentCreated({ source: 'research_agent_import' });
    const sid = provider.getSession().sessionId;
    provider.updateTitle(nextDocumentId, sid, title);
    sessionStorage.setItem('research-agent-pending-doc', nextDocumentId);
    router.replace(`${editorPath()}?doc=${nextDocumentId}`);
  }, [mounted, searchParams, documentId, createDocument, provider, router]);

  // ---- Research Agent → AI Editor import (phase 2: seed content) ----
  const researchImportPhase2Ref = useRef(false);
  useEffect(() => {
    if (researchImportPhase2Ref.current) return;
    if (!documentId || !editor || documentSnapshot?.id !== documentId) return;
    if (isAuthenticated && !crdtCollaboration.isReady) return;

    const pendingDoc = sessionStorage.getItem('research-agent-pending-doc');
    if (!pendingDoc || pendingDoc !== documentId) return;

    researchImportPhase2Ref.current = true;
    const acknowledge = captureEditorHandoff('research-agent');

    const html = sessionStorage.getItem('research-agent-editor-content') || localStorage.getItem('research-agent-editor-content');
    const markdown = sessionStorage.getItem('research-agent-editor-markdown') || localStorage.getItem('research-agent-editor-markdown');
    const savedStyle = sessionStorage.getItem('research-agent-editor-citation-style') || localStorage.getItem('research-agent-editor-citation-style') || 'apa';

    if (!html && !markdown) return;

    void (async () => { try {
      await loadCslStyle(savedStyle);
      let parsed: Block<any, any, any>[] = [];
      // Rich HTML owns the embedded BibTeX. A stale/legacy Markdown payload
      // must not take precedence and flatten those citations to ordinary text.
      if (html?.trim()) {
        parsed = editor.tryParseHTMLToBlocks(prepareStudioHtmlForEditor(html, savedStyle));
      } else if (markdown?.trim()) {
        const editorWithMarkdown = editor as typeof editor & {
          tryParseMarkdownToBlocks?: (value: string) => Block<any, any, any>[];
        };
        parsed = editorWithMarkdown.tryParseMarkdownToBlocks?.(markdown) || [];
      }

      if (!parsed.length) throw new Error('The research document could not be imported. Its original export has been retained.');
      editor.replaceBlocks(editor.document, parsed as any);

      if (savedStyle) {
        window.localStorage.setItem(
          `${AI_EDITOR_CITATION_STYLE_STORAGE_KEY}:${documentId}`,
          savedStyle,
        );
        setCitationStyle(savedStyle);
      }

      syncCitationStorageFromEditor(savedStyle);
      if (isUsingCrdt) await crdtCollaboration.flush();
      await flushBlocks(getEditorBlocks(editor));
      acknowledge();
      setImportError(null);
      moduleAnalytics.completed('ai_editor', 'import', {source: 'research-agent'});
    } catch (err) {
      console.error('Failed to seed research agent content into editor:', err);
      setImportError('The research document import could not finish. The original export is retained. Retry once your connection is available.');
      moduleAnalytics.failed('ai_editor', 'import', 'handoff_failed', undefined, {source: 'research-agent'});
    } })();
  }, [documentId, editor, documentSnapshot, syncCitationStorageFromEditor, isAuthenticated, crdtCollaboration.isReady, crdtCollaboration.flush, isUsingCrdt, flushBlocks, importAttempt]);

  // ---- Template → new document (fill it once the editor is ready) ----
  const templateSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!documentId || !editor || documentSnapshot?.id !== documentId) return;
    if (isAuthenticated && !crdtCollaboration.isReady) return;
    if (templateSeededRef.current === documentId) return;
    let pending: { documentId?: string; templateId?: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_TEMPLATE_KEY) || 'null');
    } catch {
      pending = null;
    }
    if (!pending || pending.documentId !== documentId) return;
    templateSeededRef.current = documentId;
    try {
      sessionStorage.removeItem(PENDING_TEMPLATE_KEY);
    } catch {
      /* ignore */
    }
    const template = findTemplate(pending.templateId);
    if (!template) return;
    const isEmpty = editor.document.length <= 1 && editor.document.every((block) => !Array.isArray(block.content) || block.content.length === 0);
    if (!isEmpty) return;
    void (async () => {
      try {
        if (!documentSnapshot?.title || documentSnapshot.title === 'Untitled document') updateTitle(template.title);
        editor.replaceBlocks(editor.document, templateBlocks(template) as any);
        if (isUsingCrdt) await crdtCollaboration.flush();
        await flushBlocks(getEditorBlocks(editor));
      } catch (error) {
        console.error('Could not fill the template:', error);
      }
    })();
  }, [documentId, editor, documentSnapshot, isAuthenticated, crdtCollaboration.isReady, crdtCollaboration.flush, isUsingCrdt, flushBlocks, updateTitle]);

  if (!mounted) {
    return null;
  }

  const navRecentDocuments = [
    ...recentDocuments,
    ...sharedDocuments.filter((shared) => !recentDocuments.some((owned) => owned.id === shared.id)),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  const documentsDrawer = {
    activeDocumentId: documentId,
    onOpenDocument: handleSelectDocument,
    onCreateDocument: handleCreateDocument,
    onOpenHome: handleOpenDocsHome,
  };
  const appNav = (
    <EditorAppNav
      // Documents page: the menu from tablet width; a document needs the room, so only from 1280px.
      // Beside Find papers or Library only from 1280px; below that the drawer takes its place.
      className={sideloads.drawer ? (sideloads.menu ? 'hidden xl:flex' : 'hidden') : isNavCollapsed ? 'hidden' : documentId ? 'hidden xl:flex' : 'hidden md:flex'}
      onCollapse={sideloads.drawer ? () => setSideloadMenu(false) : toggleNavCollapsed}
      onOpenChat={documentId ? () => setAssistantTab((current) => (current === 'chat' ? null : 'chat')) : undefined}
      chatActive={documentId ? assistantTab === 'chat' : undefined}
      recentDocuments={navRecentDocuments}
      activeDocumentId={documentId}
      onCreateDocument={handleCreateDocument}
      onOpenDocument={handleSelectDocument}
    />
  );
  // The full menu over the page on phones and tablets (the header's menu button).
  const appMenuOverlay = isAppMenuOpen ? (
    <div className="fixed inset-0 z-[12900]">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 h-full w-full cursor-default bg-[rgba(15,23,42,.35)]"
        onClick={() => setIsAppMenuOpen(false)}
      />
      <div className="absolute inset-y-0 left-0 max-w-[85vw] overflow-y-auto bg-white">
        {editorConfig.renderNavigation ? (
          <NavigationSidebar />
        ) : (
          <EditorAppNav
            className="flex"
            onOpenChat={documentId ? () => setAssistantTab('chat') : undefined}
            chatActive={documentId ? assistantTab === 'chat' : undefined}
            onToolOpened={() => setIsAppMenuOpen(false)}
            recentDocuments={navRecentDocuments}
            activeDocumentId={documentId}
            onCreateDocument={handleCreateDocument}
            onOpenDocument={handleSelectDocument}
          />
        )}
      </div>
    </div>
  ) : null;

  if (!documentId) {
    return (
      <main className="ai-editor-theme flex min-h-dvh bg-white lg:h-dvh lg:overflow-hidden">
        {appNav}
        <AppToolDrawer documents={documentsDrawer} />
        <div className="min-w-0 flex-1 lg:overflow-y-auto">
          <GoogleDocsHome
            signedIn={authLoading || isAuthenticated}
            ownedDocuments={recentDocuments}
            sharedDocuments={sharedDocuments}
            onCreateDocument={handleCreateDocument}
            onCreateFromTemplate={handleCreateFromTemplate}
            onImportFile={handleImportWordFile}
            onOpenDocument={handleSelectDocument}
            onDeleteDocument={handleDeleteDocument}
            onRenameDocument={handleRenameDocument}
          />
        </div>
        <AppChatSideload />
        <EditorToaster />
        <AuthModal module="AI Article Generator" reason="write and save documents" isOpen={authPrompt !== null} initialMode={authPrompt ?? 'signup'} onClose={() => setAuthPrompt(null)} />
      </main>
    );
  }

  // A document link opened while signed out: say why instead of opening an editor that cannot save.
  if (!authLoading && !isAuthenticated) {
    return (
      <main className="ai-editor-theme flex min-h-dvh flex-col bg-[#f8fafc]">
        <section className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-[460px] rounded-[16px] border border-[#e5e7eb] bg-white px-6 py-8 text-center shadow-[0_22px_50px_-18px_rgba(15,23,42,.25)]">
            <div className="text-[18px] font-bold text-[#0f172a]">Sign in to open this document</div>
            <p className="mt-2 text-[14px] leading-[1.6] text-[#64748b]">
              Documents are saved to your Videmak account. Sign in, or create a free account, to write, cite and review with AI.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={() => setAuthPrompt('login')} className="h-[42px] rounded-[11px] bg-[var(--theme-primary)] px-[18px] text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] hover:bg-[var(--theme-primary-dark)]">Sign in</button>
              <button type="button" onClick={() => setAuthPrompt('signup')} className="h-[42px] rounded-[11px] border border-[#e5e7eb] bg-white px-[18px] text-[15px] font-semibold text-[#0f172a] hover:bg-[#f8fafc]">Create a free account</button>
            </div>
            <button type="button" onClick={handleOpenDocsHome} className="mt-4 text-[14px] text-[#64748b] underline underline-offset-2 hover:text-[#0f172a]">Back to documents</button>
          </div>
        </section>
        <AuthModal module="AI Article Generator" reason="write and save documents" isOpen={authPrompt !== null} initialMode={authPrompt ?? 'login'} onClose={() => setAuthPrompt(null)} />
      </main>
    );
  }

  if (!documentSnapshot) {
    return (
      <main className="ai-editor-theme flex h-dvh overflow-hidden bg-white">
        {appNav}
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center" role="status">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#dbeafe] border-t-[var(--theme-primary)]" aria-hidden="true" />
          <div className="text-[15px] font-semibold text-[#0f172a]">Opening document…</div>
          <div className="max-w-[420px] text-[13.5px] text-[#64748b]">
            {isAuthenticated
              ? 'If this document does not exist yet, it will be created automatically.'
              : 'Sign in to load shared documents, or continue with a local draft.'}
          </div>
        </section>
      </main>
    );
  }

  // "Fit" (the default) shrinks the page to the window when it is narrower than
  // the page, like Docs and Word; a chosen percentage is kept as is.
  // A Word document's own page size wins over the on-screen width setting.
  const effectivePageWidth = wordPage?.width ?? documentPageWidth;
  const fitZoomPercentage = documentViewWidth > 0
    ? Math.floor(((documentViewWidth - (paginationConfig ? 32 : 0)) / effectivePageWidth) * 100)
    : 100;
  const pageZoomPercentage = documentZoom === 'Fit'
    ? Math.max(50, Math.min(100, fitZoomPercentage))
    : getZoomPercentage(documentZoom);

  // Margin comment cards need ~272px beside the page; with the panel open (or no room)
  // comments live in the panel only. AI review comments are always panel-only.
  const aiCommentIds = new Set(comments.filter((comment) => comment.kind === 'ai-review').map((comment) => comment.id));
  const showMarginComments =
    !assistantTab && documentViewWidth > 0 && (documentViewWidth - effectivePageWidth * (pageZoomPercentage / 100)) / 2 >= 276;

  const getArticleViewHtml = () => (
    editorSurfaceRef.current?.querySelector('[contenteditable="true"]')?.innerHTML ?? ''
  );

  return (
    <main className="ai-editor-theme relative flex h-dvh overflow-hidden bg-white">
      <EditorToaster />
      {appNav}
      <AppToolDrawer
        documents={documentsDrawer}
        library={{
          citing: isInsertingCitation,
          onCite: (libraryDocument) => void handleCitationPick(libraryDocument),
          onAsk: (libraryDocument) => {
            setChatMentions((current) =>
              current.some((mention) => mention.id === libraryDocument.id)
                ? current
                : [...current, { id: libraryDocument.id, title: libraryDocument.title || libraryDocument.filename }],
            );
            setAssistantTab('chat');
          },
        }}
        papers={{ onCite: citePaper, onSave: savePaperToLibrary, savedKeys: savedPaperKeys, suggestedQueries: suggestedPaperQueries, documentTitle }}
      />
      {appMenuOverlay}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative z-[11000] shrink-0">
          <GoogleDocsHeader
            documentId={documentId}
            wordSettings={wordSettings}
            onWordSettingsChange={handleWordSettingsChange}
            isPageView={isPageView}
            onPageViewToggle={togglePageView}
            documentComments={comments}
            editor={editor}
            documentTitle={documentTitle}
            onDocumentTitleChange={updateTitle}
            documentStatusLabel={acknowledgedConnectionLabel}
            collaborators={collaborators}
            sharedMembers={members}
            isLinkSharingEnabled={documentSnapshot.share.isLinkSharingEnabled}
            currentUserDisplayName={session?.displayName ?? 'Guest'}
            activeRole={effectiveRole}
            canEdit={isWritingEnabled}
            onShareClick={() => setIsShareDialogOpen(true)}
            onCopyLinkClick={handleCopyShareLink}
            onPrintClick={handlePrintDocument}
            onVersionHistoryClick={() => setIsVersionHistoryOpen(true)}
            onOpenAssistant={(tab) => setAssistantTab(tab)}
            onInsertCitation={openCitationSearch}
            onInsertInlineEquation={openInlineEquation}
            onDocsHomeClick={handleOpenDocsHome}
            onCreateDocumentClick={handleCreateDocument}
            onDuplicateDocumentClick={handleDuplicateDocument}
            onDeleteDocumentClick={handleDeleteCurrentDocument}
            onMainMenuClick={handleMainMenuClick}
            isNavCollapsed={isNavCollapsed}
            isStarred={isDocumentStarred}
            onStarToggle={handleToggleDocumentStar}
            isOutlinePanelVisible={isOutlinePanelVisible}
            onOutlineToggle={() => setIsOutlinePanelVisible((current) => !current)}
            canComment={canComment}
            onCommentClick={() => handleOpenComments(true)}
            onShowCommentsClick={() => handleOpenComments(false)}
            onBookmarkClick={handleAddBookmark}
            editingModeValue={surfaceMode}
            onEditingModeChange={(value) => setSurfaceMode(value as 'Editing' | 'Suggesting' | 'Viewing')}
            pageWidthPx={effectivePageWidth}
            onPageWidthChange={(value) => setDocumentPageWidth(value)}
            zoomValue={documentZoom}
            onZoomChange={setDocumentZoom}
            spellCheckEnabled={isSpellcheckEnabled}
            onSpellCheckToggle={() => setIsSpellcheckEnabled((current) => !current)}
            citationStyle={citationStyle}
            onCitationStyleChange={setCitationStyle}
            aiWritingSuggestionsEnabled={areAIWritingSuggestionsEnabled}
            autocompleteSettings={autocompleteSettings}
            onAutocompleteSettingsChange={changeAutocompleteSettings}
            onToggleAIWritingSuggestions={() => setAreAIWritingSuggestionsEnabled((current) => !current)}
            aiReviewSuggestionsEnabled={areAIReviewSuggestionsEnabled}
            onToggleAIReviewSuggestions={() => setAreAIReviewSuggestionsEnabled((current) => !current)}
            onStartWritingClick={() => setIsStartWritingDialogOpen(true)}
            isAIWritingActive={aiSuggestion.isActive || aiSuggestion.isLoading}
            isAIWritingLoading={aiSuggestion.isLoading}
            humanScore={humanScore}
            flaggedCount={flaggedCount}
            onViewAndHumanizeClick={handleOpenParagraphReview}
            onReviewClick={() => setAssistantTab('review')}
            articleViewAction={
              <ArticleViewButton
                title={documentTitle || 'Document'}
                html=""
                getHtml={getArticleViewHtml}
                sourceId={`ai-editor:${documentId || documentSnapshot.id}`}
                citationStyle={citationStyle}
              />
            }
          />
        </div>

        {importError && <div role="alert" className="border-y border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {importError} <button className="ml-2 underline" onClick={() => {
            thesisImportPhase2Ref.current = false;
            researchImportPhase2Ref.current = false;
            setImportError(null);
            setImportAttempt(attempt => attempt + 1);
          }}>Retry import</button>
        </div>}
        {/* Below the header: the page, then the open tool, then the tool rail. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <section className={`relative z-0 flex min-h-0 flex-1 overflow-hidden ${paginationConfig ? 'bg-[#f8fafc]' : 'bg-white'}`}>
                <div
                  ref={attachDocumentScrollContainer}
                  className={`relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto ${paginationConfig ? 'md:px-4 md:pt-[72px]' : 'md:pt-3'}`}
                >
                  {requiresAccountForInvite ? (
                    <div className="mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] rounded-[14px] border border-[#e5e7eb] bg-white px-4 py-4 text-[14px] text-[#64748b]">
                      <div className="font-medium text-[#0f172a]">Account required for invited collaboration</div>
                      <div className="mt-1">
                        Shared documents are tied to user accounts. Create an account or sign in first, then this document will appear in your shared documents list if your email was invited.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleAuthRedirect('login')}
                          className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--theme-primary)] px-4 text-sm font-medium text-[var(--theme-app-text)] transition-colors hover:bg-[var(--theme-primary-dark)]"
                        >
                          Sign in
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAuthRedirect('signup')}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e5e7eb] px-4 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9]"
                        >
                          Create account
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {isAuthenticated && invitedMember ? (
                    <div className="mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] rounded-[14px] border border-[#e5e7eb] bg-[#f8fafc] px-4 py-3 text-[14px] text-[#64748b]">
                      This document is shared directly with <span className="font-medium text-[#0f172a]">{user?.email}</span> as{' '}
                      <span className="font-medium capitalize text-[#0f172a]">{invitedMember.role}</span>. It will continue to appear in your shared documents list after you sign in.
                    </div>
                  ) : null}

                  {suggestions.length > 0 || isSuggesting ? (
                    <div className="mx-auto mb-3 flex w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-2 text-[14px] text-[#166534] ai-editor-print-hidden" role="status">
                      <span>
                        {isSuggesting ? 'Suggesting: your changes show as suggestions. ' : ''}
                        {suggestions.length} suggested edit{suggestions.length === 1 ? '' : 's'}
                      </span>
                      {canEdit && suggestions.length > 0 ? (
                        <>
                          <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => resolveSuggestion(null, true)}>Accept all</button>
                          <button type="button" className="font-medium text-[#a50e0e] underline-offset-2 hover:underline" onClick={() => resolveSuggestion(null, false)}>Reject all</button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {!isWritingEnabled ? (
                    <div className="mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] rounded-[14px] border border-[#e5e7eb] bg-[#f8fafc] px-4 py-3 text-[14px] text-[#64748b]">
                      {canEdit
                        ? 'Viewing mode is read-only. Switch back to Editing mode to make document changes.'
                        : effectiveRole === 'commenter'
                          ? 'This shared link opens in comment-only mode. You can follow live edits and add comments, but content changes remain locked.'
                          : 'This shared link is read-only. Ask the owner for editor access if you need to make changes.'}
                    </div>
                  ) : null}
                  {reviewError ? (
                    <div className="mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] rounded-[14px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13.5px] text-[#92400e]">
                      {reviewError}
                    </div>
                  ) : null}

                  {aiSuggestion.isActive && aiSuggestion.isLoading ? (
                    <div className="mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] rounded-[14px] border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[14px] text-[#1d4ed8]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">AI writing continues on the server</div>
                          <div className="mt-1 text-xs text-[#475569]">
                            {(aiSuggestion.stage || 'queued').replaceAll('_', ' ')} · {aiSuggestion.progressPct}%
                            {aiSuggestion.connectionState === 'reconnecting' ? ' · Reconnecting this view' : ''}
                          </div>
                        </div>
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-white">
                          <div
                            className="h-full rounded-full bg-[var(--theme-primary)] transition-all"
                            style={{ width: `${Math.max(4, aiSuggestion.progressPct)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {aiSuggestion.error ? (
                    <div className="mx-auto mb-3 flex w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)] items-center justify-between gap-3 rounded-[14px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#991b1b]">
                      <span>{aiSuggestion.error}</span>
                      {!activeAISuggestion && aiSuggestion.activeJobId ? (
                        <button
                          type="button"
                          onClick={() => void aiSuggestion.retryFailed()}
                          disabled={aiSuggestion.isLoading}
                          className="shrink-0 rounded-lg border border-[#fca5a5] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#fff7f7] disabled:opacity-50"
                        >
                          Retry saved task
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {activeAISuggestion ? (
                    // Start Writing drafts show above the page; a suggestion asked for at the cursor
                    // (the "AI suggest" pill) opens right under the paragraph it continues.
                    <div
                      ref={suggestionCardRef}
                      style={suggestionAnchor ? { position: 'absolute', top: suggestionAnchor.top, left: suggestionAnchor.left, width: suggestionAnchor.width } : undefined}
                      className={`${suggestionAnchor ? 'z-30' : 'mx-auto mb-3 w-[calc(100%-32px)] max-w-[720px] md:w-[calc(100%-144px)]'} rounded-[14px] border border-[#dbeafe] bg-white px-4 pb-3 pt-3 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]`}
                    >
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--theme-primary-dark)]">
                        <LuSparkles className="h-3.5 w-3.5" />
                        {isStartWritingFlow ? `AI draft · ${activeAISuggestion.type}` : 'AI suggestion'}
                      </div>
                      <div className="mt-1.5 max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-[15px] leading-[1.65] text-[#334155]" style={{ fontFamily: "var(--font-serif), 'Source Serif 4', Georgia, serif" }}>
                        {stripHtmlToText(activeAISuggestion.html || activeAISuggestion.text)}
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleAcceptAISuggestion()}
                          disabled={aiSuggestion.isApplying}
                          className="mr-1 h-8 rounded-lg bg-[var(--theme-primary)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--theme-primary-dark)] disabled:opacity-50"
                        >
                          {aiSuggestion.isApplying ? 'Adding…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRetryAISuggestion}
                          disabled={aiSuggestion.isApplying || aiSuggestion.isLoading}
                          className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50"
                        >
                          Try again
                        </button>
                        {isStartWritingFlow ? (
                          <button
                            type="button"
                            onClick={() => void handleConcludeAISuggestion()}
                            disabled={aiSuggestion.isApplying || aiSuggestion.isLoading}
                            className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-[var(--theme-primary-dark)] hover:bg-[#eff6ff] disabled:opacity-50"
                          >
                            Accept and conclude
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleStopAISuggestion}
                          disabled={aiSuggestion.isApplying}
                          className="ml-auto h-8 rounded-lg px-2.5 text-[13px] font-medium text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <GoogleDocsPageChrome />
                  <GoogleDocsDocumentSurface
                    zoomPercentage={pageZoomPercentage}
                    pageWidthPx={effectivePageWidth}
                    reflow={isMobile}
                    paginated={Boolean(paginationConfig)}
                  >
                    <div ref={editorSurfaceRef} className="relative bg-white" onContextMenu={handleEditorContextMenu} onClick={(event) => { handleSuggestionClick(event); handleMathClick(event); }}>
                      {suggestionPopover ? (
                        <div className="ce-suggestion-popover ai-editor-print-hidden" style={{ top: suggestionPopover.top, left: suggestionPopover.left }} role="dialog" aria-label="Suggested edit">
                          <span>
                            {suggestionPopover.suggestion.author || 'Someone'} · {suggestionPopover.suggestion.kind === 'insert' ? 'added' : suggestionPopover.suggestion.kind === 'delete' ? 'removed' : 'changed'}
                          </span>
                          {canEdit ? (
                            <>
                              <button type="button" className="accept" onClick={(event) => { event.stopPropagation(); resolveSuggestion([suggestionPopover.suggestion.id], true); }}>✓ Accept</button>
                              <button type="button" className="reject" onClick={(event) => { event.stopPropagation(); resolveSuggestion([suggestionPopover.suggestion.id], false); }}>✕ Reject</button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      <MantineProvider defaultColorScheme="light" theme={mantineTheme}>
                        <div className="relative">
                            {crdtCollaboration.isConnecting ? (
                              <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-[#e5e7eb] bg-white/95 px-3 py-1 text-[12px] font-medium text-[#64748b] backdrop-blur ai-editor-print-hidden">
                                Connecting realtime collaboration...
                              </div>
                            ) : null}
                            {activeEditingCollaborators.length ? (
                              <div className="pointer-events-none absolute right-4 top-4 z-20 flex max-w-[calc(100%-32px)] flex-wrap justify-end gap-2 ai-editor-print-hidden">
                                {activeEditingCollaborators.map((collaborator) => (
                                  <div
                                    key={collaborator.sessionId}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white/95 px-2.5 py-1 text-[12px] font-medium text-[#0f172a] backdrop-blur"
                                  >
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: collaborator.color }}
                                    />
                                    <span className="truncate">{collaborator.displayName}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {reviewAnchors.map((anchor) => {
                              if (anchor.issueId !== activeReviewIssueId) return null;

                              return (
                                <div
                                  key={anchor.issueId}
                                  data-review-card="true"
                                  className="absolute z-20 w-[280px] rounded-2xl border border-[#fde68a] bg-white p-3 text-left shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)] ai-editor-print-hidden"
                                  style={{ top: `${anchor.top + 4}px`, left: `${Math.max(0, anchor.left)}px` }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#b45309]">
                                        {anchor.category}
                                      </div>
                                      <div className="mt-1 text-[13px] font-semibold leading-5 text-[#0f172a]">
                                        {anchor.title}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setActiveReviewIssueId(null)}
                                      className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full text-[#64748b] hover:bg-[#fef3c7] transition-colors"
                                      aria-label="Close"
                                    >
                                      ×
                                    </button>
                                  </div>
                                  <div className="mt-2 text-[12px] leading-5 text-[#64748b]">
                                    {anchor.explanation}
                                  </div>
                                  <div className="mt-2 rounded-xl bg-[#fffbeb] px-2.5 py-2 text-[11px] text-[#92400e]">
                                    <div className="font-medium">Replace</div>
                                    <div className="mt-1 line-clamp-2">&ldquo;{anchor.original_text}&rdquo;</div>
                                  </div>
                                  <div className="mt-2 rounded-xl border border-[#f1f5f9] bg-white px-2.5 py-2 text-[11px] text-[#0f172a]">
                                    <div className="font-medium text-[#0f172a]">With</div>
                                    <div className="mt-1 line-clamp-3">{anchor.suggested_text}</div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={handleAcceptReviewIssue}
                                      disabled={!isWritingEnabled}
                                      className="inline-flex h-7 items-center rounded-full bg-[var(--theme-primary)] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[var(--theme-primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Accept
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => dismissReviewIssue(anchor.issueId, anchor.blockId)}
                                      className="inline-flex h-7 items-center rounded-full border border-[#fde68a] px-3 text-[11px] font-medium text-[#b45309] transition-colors hover:bg-[#fffbeb]"
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {selectionBubble && !reviewContextMenu ? (
                              <div
                                className="absolute z-30 hidden lg:flex flex-col gap-1 ai-editor-print-hidden"
                                style={{ top: `${selectionBubble.top}px`, left: 'calc(100% + 14px)' }}
                              >
                                <button
                                  type="button"
                                  aria-label="Add comment"
                                  onClick={() => {
                                    setSelectionBubble(null);
                                    handleOpenComments(true);
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--theme-primary)] shadow-[0_1px_3px_rgba(60,64,67,0.24)] ring-1 ring-[#e5e7eb] transition-all hover:shadow-[0_2px_6px_rgba(60,64,67,0.32)] hover:ring-[var(--theme-primary)]"
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17zM13 5h-2v4H7v2h4v4h2v-4h4V9h-4z"/></svg>
                                </button>
                              </div>
                            ) : null}
                            {showMarginComments && commentAnchors.map((anchor) => {
                              if (aiCommentIds.has(anchor.commentId)) return null;
                              const isExpanded = expandedCommentBlockId === anchor.blockId;
                              const replyDraft = inlineCommentReplyDrafts[anchor.commentId] ?? '';

                              return (
                                <div
                                  key={anchor.blockId}
                                  className={`absolute z-20 hidden w-[260px] rounded-xl border bg-white text-left shadow-[0_1px_3px_rgba(60,64,67,0.15)] transition-shadow lg:block ai-editor-print-hidden ${
                                    isExpanded
                                      ? 'border-[var(--theme-primary-border)] ring-1 ring-[var(--theme-primary-ring)] shadow-[0_4px_12px_rgba(60,64,67,0.2)]'
                                      : 'border-[#e5e7eb] hover:shadow-[0_4px_12px_rgba(60,64,67,0.2)] cursor-pointer'
                                  }`}
                                  style={{ top: `${anchor.top}px`, left: 'calc(100% + 12px)' }}
                                  onClick={!isExpanded ? () => {
                                    setExpandedCommentBlockId(anchor.blockId);
                                    setActiveCommentId(anchor.commentId);
                                  } : undefined}
                                  role={!isExpanded ? 'button' : undefined}
                                  tabIndex={!isExpanded ? 0 : undefined}
                                >
                                  <div className="px-3 pt-3 pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex min-w-0 items-start gap-2.5">
                                        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary-ring)] text-[10px] font-semibold text-[var(--theme-primary-dark)]">
                                          {commentInitials(anchor.actorDisplayName)}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="truncate text-[13px] font-semibold text-[#0f172a]">
                                            {anchor.actorDisplayName}
                                          </div>
                                          <div className="text-[11px] text-[#64748b]">
                                            {commentTimeLabel(anchor.createdAt)}
                                          </div>
                                        </div>
                                      </div>
                                      {isExpanded ? (
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              resolveComment(anchor.commentId, true);
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#64748b] hover:bg-[var(--theme-primary-soft)] transition-colors"
                                            title="Mark as resolved"
                                            aria-label="Mark as resolved"
                                          >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setExpandedCommentBlockId(null);
                                              setActiveCommentId(null);
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#64748b] hover:bg-[#f1f5f9] transition-colors text-[16px]"
                                            aria-label="Close"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className={`mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#0f172a] ${isExpanded ? '' : 'line-clamp-2'}`}>
                                      {anchor.text}
                                    </div>
                                  </div>

                                  {isExpanded && anchor.replies.length > 0 ? (
                                    <div className="border-t border-[#e5e7eb] mx-3 pt-2 pb-1 space-y-2">
                                      {anchor.replies.map((reply) => (
                                        <div key={reply.id} className="flex items-start gap-2">
                                          <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary-soft)] text-[9px] font-semibold text-[var(--theme-primary-dark)]">
                                            {commentInitials(reply.actorDisplayName)}
                                          </div>
                                          <div className="min-w-0">
                                            <div className="flex items-baseline gap-2">
                                              <span className="text-[12px] font-medium text-[#0f172a]">{reply.actorDisplayName}</span>
                                              <span className="text-[10px] text-[#94a3b8]">{commentTimeLabel(reply.createdAt)}</span>
                                            </div>
                                            <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#0f172a]">{reply.text}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}

                                  {isExpanded && canComment ? (
                                    <div className="border-t border-[#e5e7eb] px-3 py-2">
                                      <div className="flex items-start gap-2">
                                        <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary-soft)] text-[9px] font-semibold text-[var(--theme-primary-dark)]">
                                          {commentInitials(session?.displayName ?? 'You')}
                                        </div>
                                        <input
                                          value={replyDraft}
                                          onChange={(event) =>
                                            setInlineCommentReplyDrafts((current) => ({
                                              ...current,
                                              [anchor.commentId]: event.target.value,
                                            }))
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter' && replyDraft.trim()) {
                                              addCommentReply(anchor.commentId, replyDraft.trim());
                                              setInlineCommentReplyDrafts((current) => ({
                                                ...current,
                                                [anchor.commentId]: '',
                                              }));
                                            }
                                          }}
                                          onClick={(event) => event.stopPropagation()}
                                          placeholder="Reply or add others with @"
                                          className="h-8 min-w-0 flex-1 rounded-full border border-[#e5e7eb] bg-white px-3 text-[12px] text-[#0f172a] outline-none transition-colors focus:border-[var(--theme-primary)] placeholder:text-[#94a3b8]"
                                        />
                                      </div>
                                      {replyDraft.trim() ? (
                                        <div className="mt-2 flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setInlineCommentReplyDrafts((current) => ({
                                                ...current,
                                                [anchor.commentId]: '',
                                              }));
                                            }}
                                            className="inline-flex h-7 items-center rounded-full px-3 text-[11px] text-[#64748b] hover:bg-[#f1f5f9]"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              addCommentReply(anchor.commentId, replyDraft.trim());
                                              setInlineCommentReplyDrafts((current) => ({
                                                ...current,
                                                [anchor.commentId]: '',
                                              }));
                                            }}
                                            className="inline-flex h-7 items-center rounded-full bg-[var(--theme-primary)] px-3 text-[11px] font-medium text-[var(--theme-app-text)] hover:bg-[var(--theme-primary-dark)]"
                                          >
                                            Reply
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                            {paginationConfig && paginationConfig.headerFor(1) ? (
                              <div
                                aria-hidden="true"
                                className="ce-page-header ai-editor-print-hidden"
                                style={{ position: 'absolute', zIndex: 1, top: paginationConfig.headerOffset, left: paginationConfig.marginLeft, right: paginationConfig.marginRight }}
                                dangerouslySetInnerHTML={{ __html: paginationConfig.headerFor(1) }}
                              />
                            ) : null}
                            <BlockNoteView
                              // A new editor instance (fallback -> realtime) must get a
                              // fresh view. Reusing the old view let BlockNote's
                              // DOM listeners for the unmounted editor fire until
                              // their effects were cleaned up ("[tiptap error]: The
                              // editor view is not available ... view['posAtDOM']").
                              key={getEditorViewKey(editor)}
                              editor={editor}
                              theme="light"
                              onChange={handleEditorChange}
                              onSelectionChange={handleEditorSelectionChange}
                              sideMenu={false}
                              slashMenu={false}
                              className={`ai-editor-blocknote bg-white ${
                                isMobile
                                  ? 'ai-editor-reflow min-h-[70vh] px-5 pb-28 pt-[18px]'
                                  : paginationConfig
                                    ? 'ai-editor-paginated'
                                    : `ai-editor-pageless min-h-[70vh] ${wordPage ? '' : 'px-12 pb-28 pt-11'}`
                              }`}
                              style={paginationConfig ? {
                                paddingLeft: paginationConfig.marginLeft,
                                paddingRight: paginationConfig.marginRight,
                                paddingTop: paginationConfig.marginTop,
                                paddingBottom: 0,
                              } : !isMobile && wordPage ? {
                                paddingLeft: wordPage.left,
                                paddingRight: wordPage.right,
                                paddingTop: wordPage.top,
                                paddingBottom: wordPage.bottom,
                                minHeight: wordPage.height,
                              } : undefined}
                            >
                              {!isMobile && isWritingEnabled ? <BlockSideMenu onOpenAI={openBlockAI} /> : null}
                              <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
                              <AtCitationMenu
                                editor={editor}
                                members={members}
                                enabled={isWritingEnabled}
                                onCitePaper={(paper) => citePaper(paper)}
                                onCiteLibrary={(libraryDocument) => void handleCitationPick(libraryDocument)}
                                onCustomCitation={() => setIsCustomCitationOpen(true)}
                                onMorePapers={() => {
                                  setPapersParagraph(null);
                                  setAssistantTab('papers');
                                }}
                              />
                            </BlockNoteView>
                            {/* Pageless view shows notes only in pop-ups: printing lists them at the end
                                (Print layout puts them at the foot of each page instead). */}
                            {!paginationConfig && printNotes.length ? (
                              <ol className="ce-print-notes">
                                {printNotes.map((note, index) => (
                                  <li key={index}>{note.text}</li>
                                ))}
                              </ol>
                            ) : null}
                            {!isWritingEnabled ? (
                              <div
                                className="absolute inset-0 z-10 bg-transparent ai-editor-print-hidden"
                                aria-hidden="true"
                              />
                            ) : null}
                        </div>
                      </MantineProvider>
                    </div>
                  </GoogleDocsDocumentSurface>
                </div>
                <GoogleDocsOutlineSidebar
                  outlineItems={outlineItems}
                  bookmarkItems={bookmarkItems}
                  activeOutlineId={activeOutlineId}
                  isPanelVisible={isOutlinePanelVisible}
                  onShowPanel={() => setIsOutlinePanelVisible(true)}
                  onHidePanel={() => setIsOutlinePanelVisible(false)}
                  onSelectOutlineItem={handleOutlineSelect}
                  isMobile={isMobile}
                />
            </section>
            <EditorStatusBar
              surfaceRef={editorSurfaceRef}
              editor={editor}
              pageWidthPx={effectivePageWidth}
              zoomValue={documentZoom}
              zoomPercentage={pageZoomPercentage}
              onZoomChange={setDocumentZoom}
              citationStyle={citationStyle}
              onCitationStyleChange={setCitationStyle}
              savedLabel={acknowledgedConnectionLabel}
              pageCount={paginationConfig ? layoutPageCount : undefined}
            />
          </div>
          {assistantTab && documentId ? (
            <AssistantPanel
              tab={assistantTab}
              onTabChange={setAssistantTab}
              onClose={() => {
                setAssistantTab(null);
                setActiveCommentId(null);
              }}
              isMobile={isMobile}
              commentCount={comments.filter((comment) => comment.status !== 'resolved').length}
              panels={{
                chat: (
                  <ChatPanel
                    documentId={documentId}
                    documentTitle={documentTitle}
                    getDocumentText={getDocumentText}
                    context={chatContext}
                    onClearContext={() => setChatContext(null)}
                    mentions={chatMentions}
                    onMentionsChange={setChatMentions}
                    onInsert={(message) => void insertChatAnswer(message)}
                    onCiteSource={citeSource}
                    canInsert={isWritingEnabled}
                    isMobile={isMobile}
                    onClose={isMobile ? undefined : () => setAssistantTab(null)}
                  />
                ),
                comments: (
                  <CommentsPanel
                    comments={comments}
                    canComment={canComment}
                    currentUserSessionId={session?.sessionId ?? null}
                    currentUserDisplayName={session?.displayName ?? 'Guest'}
                    mentionableUsers={commentMentionableUsers}
                    initialSelectedText={commentDraftContext.selectedText}
                    initialBlockId={commentDraftContext.blockId}
                    activeCommentId={activeCommentId}
                    onActiveCommentChange={setActiveCommentId}
                    blockOrder={commentBlockOrder}
                    onAddComment={(comment) => {
                      addComment(comment);
                      // Posted: the box closes (keeping it open on the same quote invited duplicates).
                      setCommentDraftContext({});
                    }}
                    onAddCommentReply={addCommentReply}
                    onDeleteComment={deleteComment}
                    onResolveComment={resolveComment}
                    onUpdateComment={updateComment}
                    onFeedback={setCommentFeedback}
                    onAcceptSuggestion={acceptCommentSuggestion}
                    onAskAI={askAIInComment}
                    onRunReview={(focus) => void runReview(focus)}
                    filter={commentFilter}
                    onClearFilter={() => setCommentFilter(null)}
                    review={reviewRun}
                    onDismissReviewNotice={() => setReviewRun({ running: false, error: null, outOfCredits: false, lastAdded: null })}
                    isMobile={isMobile}
                  />
                ),
                review: (
                  <ReviewPanel
                    comments={comments}
                    memory={reviewMemory}
                    runs={checkRuns}
                    canRun={canComment}
                    onRun={(check, scope) => void runCheck(check, scope)}
                    hasSelection={selectionBlockIds.length > 0}
                    canEdit={isWritingEnabled}
                    aiChangeCount={aiChangeIds.length}
                    onShowInText={showCheckInText}
                    onResolveAIChanges={resolveAIChanges}
                    onToneChange={(tone) => updateReviewMemory((current) => ({ ...current, tone }))}
                    onShowComments={(check, category) => {
                      setCommentFilter({ check, category });
                      setAssistantTab('comments');
                    }}
                  />
                ),
                library: (
                  <LibraryPanel
                    visible={assistantTab === 'library'}
                    citing={isInsertingCitation}
                    onCite={(libraryDocument) => void handleCitationPick(libraryDocument)}
                    onAsk={(libraryDocument) => {
                      setChatMentions((current) =>
                        current.some((mention) => mention.id === libraryDocument.id)
                          ? current
                          : [...current, { id: libraryDocument.id, title: libraryDocument.title || libraryDocument.filename }],
                      );
                      setAssistantTab('chat');
                    }}
                  />
                ),
                papers: (
                  <FindPapersPanel
                    suggestedQueries={suggestedPaperQueries}
                    documentTitle={documentTitle}
                    paragraph={papersParagraph}
                    onClearParagraph={() => setPapersParagraph(null)}
                    onCite={citePaper}
                    onSave={savePaperToLibrary}
                    savedKeys={savedPaperKeys}
                    isMobile={isMobile}
                  />
                ),
              }}
            />
          ) : null}
          {documentId ? (
            <EditorSideRail
              isOutlineVisible={isOutlinePanelVisible}
              onToggleOutline={() => setIsOutlinePanelVisible((current) => !current)}
              activeTab={assistantTab}
              onToggleTab={(tab) => {
                if (sideloads.drawer === tab) closeSideloadDrawer();
                setAssistantTab((current) => (current === tab ? null : tab));
                if (tab !== 'comments') setActiveCommentId(null);
                else setCommentFilter(null);
              }}
              onWriteWithAI={isWritingEnabled ? () => setIsStartWritingDialogOpen(true) : undefined}
              commentCount={comments.filter((comment) => comment.status !== 'resolved').length}
            />
          ) : null}
        </div>
      </div>


      <MobileEditorToolbar
        editor={editor}
        surfaceRef={editorSurfaceRef}
        enabled={isMobile && isWritingEnabled}
        onComment={() => handleOpenComments(true)}
        onWriteWithAI={isWritingEnabled ? openBlockAIForCursor : undefined}
        onCite={openCitationSearch}
        onEquation={openInlineEquation}
      />

      {autocompleteState.writingAt ? (
        // "Videmak AI" writes at the cursor until the grey text appears.
        <div className="pointer-events-none fixed z-[11500]" style={{ top: autocompleteState.writingAt.top - 20, left: autocompleteState.writingAt.left - 1 }} aria-live="polite">
          <span className="block w-fit rounded-[5px] rounded-bl-none bg-[var(--theme-primary)] px-1.5 py-[2px] text-[11px] font-semibold leading-none text-white">Videmak AI</span>
          <span className="block h-[22px] w-[2px] animate-pulse bg-[var(--theme-primary)]" />
        </div>
      ) : null}

      {cursorActionBar.visible && pendingGhostBlockIds.length === 0 && !autocompleteState.bar && !autocompleteState.writingAt ? (
        <div
          className="fixed z-[11500]"
          style={{
            top: cursorActionBar.position.top,
            left: cursorActionBar.position.left,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-1 rounded-[10px] border border-[#e5e7eb] bg-white p-[3px] shadow-[0_10px_24px_-12px_rgba(15,23,42,.4)]">
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                autocompleteState.suggestHere();
              }}
              disabled={isInsertingCitation}
              title="Write the next part here, with citations"
              className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[7px] bg-[#eff6ff] px-2 text-[12px] font-semibold text-[var(--theme-primary)] transition-colors hover:bg-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {cursorActionBar.loading ? (
                <>
                  <span className="inline-flex gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--theme-primary)]" style={{ animationDelay: '0ms' }} />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--theme-primary)]" style={{ animationDelay: '150ms' }} />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--theme-primary)]" style={{ animationDelay: '300ms' }} />
                  </span>
                  <span>Writing</span>
                </>
              ) : (
                <>
                  <LuSparkles className="h-3.5 w-3.5" />
                  <span>AI suggest</span>
                </>
              )}
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsCitationPickerOpen(true);
              }}
              disabled={cursorActionBar.loading || isInsertingCitation}
              title="Insert a citation here"
              className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-[12px] font-semibold text-[#b45309] transition-colors hover:bg-[#fffbeb] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LuQuote className="h-3.5 w-3.5" />
              <span>{isInsertingCitation ? 'Adding…' : 'Cite'}</span>
            </button>
          </div>
        </div>
      ) : null}

      {pendingGhostBlockIds.length > 0 && ghostActionBarPosition ? (
        <div
          className="fixed z-[11500]"
          style={{
            top: ghostActionBarPosition.top,
            left: ghostActionBarPosition.left,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-1 rounded-[10px] border border-[#e5e7eb] bg-white p-[3px] shadow-[0_10px_24px_-12px_rgba(15,23,42,.4)]">
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleAcceptAISuggestion();
              }}
              className="flex items-center gap-0.5 h-6 rounded-[7px] bg-[var(--theme-primary)] px-2 text-[12px] font-semibold leading-none text-white transition-colors hover:bg-[var(--theme-primary-dark)]"
            >
              <span>✓</span>
              <span>Accept</span>
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleRetryAISuggestion();
              }}
              disabled={aiSuggestion.isLoading}
              className="flex items-center gap-0.5 h-6 rounded-[7px] px-2 text-[12px] font-semibold leading-none text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>↻</span>
              <span>Try again</span>
            </button>
            {isStartWritingFlow ? (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleConcludeAISuggestion();
                }}
                disabled={aiSuggestion.isLoading}
                className="flex items-center gap-0.5 h-6 rounded-[7px] px-2 text-[12px] font-semibold leading-none text-[var(--theme-primary)] transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>Conclude</span>
              </button>
            ) : null}
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleStopAISuggestion();
              }}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none text-red-500 transition-colors hover:bg-red-50"
            >
              <span>×</span>
              <span>Stop</span>
            </button>
          </div>
        </div>
      ) : null}

      {reviewContextMenu ? (
        <div
          className="fixed z-[11520]"
          style={{
            top: reviewContextMenu.position.top,
            left: reviewContextMenu.position.left,
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="w-[210px] rounded-2xl border border-[#fde68a] bg-white/98 p-2 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)] backdrop-blur">
            <div className="px-2 pb-2 pt-1 text-[11px] font-medium text-[#92400e]">
              Review selected text
            </div>
            <button
              type="button"
              onClick={() => void handleRunSelectionReview('grammar')}
              className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[#fffbeb]"
            >
              <span>Grammar suggestion</span>
              <span className="text-[#b45309]">Open</span>
            </button>
            {(reviewContextMenu.selection.selectedText.length >= 80 ||
              reviewContextMenu.selection.selectedText.split(/\s+/).filter(Boolean).length >= 12) ? (
              <button
                type="button"
                onClick={() => void handleRunSelectionReview('rewrite')}
                className="mt-1 flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-[12px] text-[#0f172a] transition-colors hover:bg-[#fffbeb]"
              >
                <span>Rewrite selection</span>
                <span className="text-[#b45309]">Focus</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {aiSuggestion.isLoading && pendingGhostBlockIds.length === 0 && cursorActionBar.loading ? null : null}

      <style>{`
        ::highlight(ai-editor-comment-highlight) {
          background: rgba(251, 188, 4, 0.28);
        }

        ::highlight(ai-editor-comment-highlight-active) {
          background: rgba(251, 188, 4, 0.5);
        }

        /* AI review: the mockup's amber highlight with an amber underline. */
        ::highlight(ai-editor-review-highlight) {
          background: rgba(254, 243, 199, 0.75);
          text-decoration: underline;
          text-decoration-thickness: 2px;
          text-decoration-color: #f59e0b;
          text-underline-offset: 4px;
        }

        ::highlight(ai-editor-review-highlight-active) {
          background: #fef3c7;
          text-decoration: underline;
          text-decoration-thickness: 2px;
          text-decoration-color: #d97706;
          text-underline-offset: 4px;
        }

        .ai-ghost-block {
          position: relative;
          border-left: 3px solid var(--theme-primary);
          padding-left: 12px;
          margin-left: -15px;
          background: linear-gradient(to right, rgba(37, 99, 235, 0.04), transparent);
        }
        .ai-ghost-block,
        .ai-ghost-block p,
        .ai-ghost-block h1,
        .ai-ghost-block h2,
        .ai-ghost-block h3,
        .ai-ghost-block li,
        .ai-ghost-block span:not(.citation-token) {
          color: #9ca3af !important;
        }
        .ai-ghost-block .citation-token {
          background-color: #f3f4f6 !important;
          color: #9ca3af !important;
          border: 1px dashed #d1d5db;
        }

        /* Document text: Source Serif 4, as in the mockups (pageless 18.5px, print layout 12pt,
           phones 16.5px). Word documents bring their own fonts through wordSettingsCss. */
        .ai-editor-blocknote {
          font-family: var(--font-serif), "Source Serif 4", Georgia, serif;
          font-size: 18.5px;
          line-height: 1.75;
          color: #1e293b;
        }
        .ai-editor-blocknote.ai-editor-paginated {
          font-size: 16px;
          line-height: 1.65;
        }
        .ai-editor-blocknote.ai-editor-reflow {
          font-size: 16.5px;
          line-height: 1.7;
        }

        .ai-editor-blocknote .bn-editor,
        .ai-editor-blocknote .bn-block-content,
        .ai-editor-blocknote .bn-inline-content {
          font-family: inherit;
          line-height: inherit;
        }
        .ai-editor-blocknote .bn-editor {
          font-size: inherit;
          color: inherit;
        }

        .ai-editor-blocknote .bn-block-outer {
          margin-top: 0;
          margin-bottom: 0;
          line-height: inherit;
        }
        .ai-editor-blocknote .bn-block-content[data-content-type="paragraph"] {
          padding-block: 7px;
        }

        /* Heading 1 has no data-level attribute (BlockNote leaves default props out). */
        .ai-editor-blocknote [data-content-type="heading"] {
          --level: 2.054em;
          line-height: 1.15;
          letter-spacing: -0.01em;
          margin-top: 0.4em;
          margin-bottom: 0.58em;
          font-family: inherit;
          font-weight: 700;
          color: #0f172a;
        }
        .ai-editor-blocknote .bn-block-group > .bn-block-outer:first-child > .bn-block > [data-content-type="heading"] {
          margin-top: 0;
        }

        .ai-editor-blocknote [data-content-type="heading"][data-level="2"] {
          --level: 1.3em;
          line-height: 1.25;
          letter-spacing: 0;
          font-weight: 600;
          margin-top: 1.08em;
          margin-bottom: 0.42em;
        }

        .ai-editor-blocknote [data-content-type="heading"][data-level="3"] {
          --level: 1.08em;
          line-height: 1.3;
          letter-spacing: 0;
          font-weight: 600;
          margin-top: 1em;
          margin-bottom: 0.3em;
        }

        .ai-editor-blocknote [data-content-type="heading"][data-level="4"],
        .ai-editor-blocknote [data-content-type="heading"][data-level="5"],
        .ai-editor-blocknote [data-content-type="heading"][data-level="6"] {
          --level: 1em;
          line-height: 1.35;
          letter-spacing: 0;
          font-weight: 600;
          margin-top: 0.9em;
          margin-bottom: 0.25em;
        }

        .ai-editor-blocknote.ai-editor-reflow [data-content-type="heading"]:not([data-level]) { --level: 1.576em; line-height: 1.2; }
        .ai-editor-blocknote.ai-editor-reflow [data-content-type="heading"][data-level="2"] { --level: 1.152em; margin-top: 0.75em; margin-bottom: 0.3em; }
        .ai-editor-blocknote.ai-editor-reflow [data-content-type="heading"][data-level="3"] { --level: 1.05em; }
        .ai-editor-blocknote.ai-editor-paginated [data-content-type="heading"]:not([data-level]) { --level: 1.75em; }
        .ai-editor-blocknote.ai-editor-paginated [data-content-type="heading"][data-level="2"] { --level: 1.3em; }
        .ai-editor-blocknote.ai-editor-paginated [data-content-type="heading"][data-level="3"] { --level: 1.1em; }

        .ai-editor-blocknote [data-prev-level="1"] { --prev-level: 2.054em; }
        .ai-editor-blocknote [data-prev-level="2"] { --prev-level: 1.3em; }
        .ai-editor-blocknote [data-prev-level="3"] { --prev-level: 1.08em; }
        .ai-editor-blocknote [data-prev-level="4"],
        .ai-editor-blocknote [data-prev-level="5"],
        .ai-editor-blocknote [data-prev-level="6"] { --prev-level: 1em; }

        .ai-editor-blocknote [data-content-type="heading"] h1,
        .ai-editor-blocknote [data-content-type="heading"] h2,
        .ai-editor-blocknote [data-content-type="heading"] h3,
        .ai-editor-blocknote [data-content-type="heading"] h4,
        .ai-editor-blocknote [data-content-type="heading"] h5,
        .ai-editor-blocknote [data-content-type="heading"] h6 {
          font-family: inherit;
          font-weight: inherit;
          line-height: inherit;
          letter-spacing: inherit;
          margin: 0;
        }

        .ai-editor-blocknote [data-text-alignment="center"] {
          text-align: center;
        }

        ${WORD_EDITOR_CSS}
        ${PAGINATION_CSS}
        ${SUGGESTION_CSS}
        ${AUTOCOMPLETE_CSS}
        ${EQUATION_CSS}
        .ai-editor-blocknote .bn-side-menu .ce-side-ai svg { color: var(--theme-primary); }
        .ce-chat-markdown p { margin: 0 0 8px; }
        .ce-chat-markdown p:last-child { margin-bottom: 0; }
        .ce-chat-markdown ul, .ce-chat-markdown ol { margin: 4px 0 8px 18px; }
        .ce-chat-markdown ul { list-style: disc; }
        .ce-chat-markdown ol { list-style: decimal; }
        .ce-chat-markdown h1, .ce-chat-markdown h2, .ce-chat-markdown h3 { font-weight: 600; margin: 10px 0 6px; }
        .ce-chat-markdown code { background: #f1f5f9; border-radius: 4px; padding: 0 4px; }
        ${wordSettingsCss(wordSettings)}

        /* The page padding is the document margin (1 inch, as in Word); BlockNote's own
           54px gutter for its drag handles would add to it. */
        .ai-editor-blocknote .bn-editor {
          padding-inline: 0;
        }

        /* Phones format through the keyboard toolbar; drag handles would sit on the text. */
        .ai-editor-blocknote.ai-editor-reflow .bn-side-menu {
          display: none !important;
        }

        /* Phone layout: no paper margins to bleed page-break bars into. */
        .ai-editor-blocknote.ai-editor-reflow .bn-block-content[data-content-type="pageBreak"] > div {
          margin-left: -1rem !important;
          margin-right: -1rem !important;
        }
      `}</style>

      <AIEditorShareDialog
        isOpen={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
        documentSnapshot={documentSnapshot}
        collaborators={collaborators}
        members={members}
        activity={activity}
        currentUserDisplayName={session?.displayName ?? 'Guest'}
        currentUserEmail={user?.email ?? null}
        isOwner={effectiveRole === 'owner'}
        onUpdateShareSettings={updateShareSettings}
        onAddMember={addMember}
        onUpdateMemberRole={updateMemberRole}
        onRemoveMember={removeMember}
        onUpdateSessionDisplayName={updateSessionDisplayName}
      />
      <AIEditorActivityDialog
        isOpen={isActivityDialogOpen}
        onClose={() => setIsActivityDialogOpen(false)}
        activity={activity}
      />
      <StartWritingModal
        isOpen={isStartWritingDialogOpen}
        onClose={() => setIsStartWritingDialogOpen(false)}
        onStart={handleStartWriting}
        initialSource={aiSuggestion.sourceType}
        initialTopic={documentTitle}
      />
      <CitationInsertModal
        isOpen={isCitationPickerOpen}
        isLoading={isInsertingCitation}
        onClose={() => setIsCitationPickerOpen(false)}
        onSelect={handleCitationPick}
      />
      <CitationTooltip
        containerRef={editorSurfaceRef as React.RefObject<HTMLElement>}
        onView={handleCitationView}
        onEdit={isWritingEnabled ? handleCitationEdit : undefined}
        onNarrative={isWritingEnabled ? handleCitationNarrative : undefined}
        onSave={handleCitationSave}
        lookup={lookupCitation}
        openOnClick
      />
      {citationEditor ? (
        <CitationEditPopover
          anchor={citationEditor.anchor}
          title={citationEditor.title}
          initial={citationEditor.attrs}
          onClose={() => setCitationEditor(null)}
          onRemove={() => {
            const view = safeView(editor);
            const node = view?.state.doc.nodeAt(citationEditor.pos);
            if (view && node?.type.name === 'aiCitation') {
              view.dispatch(view.state.tr.delete(citationEditor.pos, citationEditor.pos + node.nodeSize));
              window.setTimeout(() => syncCitationStorageFromEditor(citationStyle, { force: true }), 0);
            }
            setCitationEditor(null);
          }}
          onSave={(value) => {
            updateCitationNode(citationEditor.pos, {
              mode: value.mode || '',
              locator: value.locator || '',
              prefix: value.prefix || '',
              suffix: value.suffix || '',
            });
            setCitationEditor(null);
          }}
        />
      ) : null}
      <VersionHistoryDialog
        isOpen={isVersionHistoryOpen}
        onClose={() => setIsVersionHistoryOpen(false)}
        documentId={documentId}
        getCurrentBlocks={() => getEditorBlocks(editor) as any[]}
        canRestore={canEdit}
        onRestore={applyRestoredVersion}
        prepare={async () => {
          if (isUsingCrdt && canEdit) await flushBlocks(getEditorBlocks(editor)).catch(() => undefined);
        }}
      />
      <CustomCitationDialog isOpen={isCustomCitationOpen} onClose={() => setIsCustomCitationOpen(false)} onCite={citeCustom} />
      {blockAI && blockAITarget && blockAI.mode === 'menu' ? (
        <BlockAIMenu
          anchor={blockAI.anchor}
          words={blockWords(blockAITarget.content)}
          onAction={handleBlockAIAction}
          onClose={closeBlockAI}
          canEdit={isWritingEnabled}
          canComment={canComment}
        />
      ) : null}
      {blockAI && blockAITarget && blockAI.mode === 'edit' ? (
        <AIEditBox
          anchor={blockAI.anchor}
          block={{ id: blockAITarget.id, content: blockAITarget.content }}
          documentTitle={documentTitle}
          contextBefore={blockAIContext.before}
          contextAfter={blockAIContext.after}
          onApply={applyAIEdit}
          onClose={closeBlockAI}
          isMobile={isMobile}
        />
      ) : null}
      {mathEditor ? (
        <EquationEditor
          initial={mathEditor.latex}
          displayMode={false}
          anchor={mathEditor.anchor}
          onSave={saveInlineEquation}
          onCancel={() => setMathEditor(null)}
          onRemove={mathEditor.pos !== null ? () => saveInlineEquation('') : undefined}
        />
      ) : null}
      {autocompleteState.bar ? (
        // The bar under the grey text: Accept (Tab), Refine, Conclude, feedback.
        <div
          className="ce-ghost-bar fixed z-[12550] flex items-center gap-1 rounded-[12px] border border-[#e5e7eb] bg-white p-1 text-[13px] font-medium text-[#334155] shadow-[0_12px_28px_-12px_rgba(15,23,42,.35)]"
          style={{ top: autocompleteState.bar.top, left: autocompleteState.bar.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => autocompleteState.accept()} className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-[var(--theme-primary)] pl-3 pr-1.5 font-semibold text-white hover:bg-[var(--theme-primary-dark)]">
            Accept <span className="rounded-[6px] bg-white/[.18] px-1.5 py-0.5 text-[11.5px]">Tab</span>
          </button>
          <button type="button" onClick={autocompleteState.refine} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 hover:bg-[#f1f5f9] hover:text-[#0f172a]">
            <LuSparkles className="h-3.5 w-3.5 text-[var(--theme-primary)]" />Refine suggestion
          </button>
          <button type="button" onClick={autocompleteState.conclude} title="Close this section with a concluding statement and start the next one" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 hover:bg-[#f1f5f9] hover:text-[#0f172a]">
            <LuFlag className="h-3.5 w-3.5" />Conclude
          </button>
          <button type="button" aria-label="Good suggestion" onClick={() => autocompleteState.feedback('up')} className="grid h-8 w-8 place-items-center rounded-[9px] text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"><LuThumbsUp className="h-4 w-4" /></button>
          <button type="button" aria-label="Bad suggestion" onClick={() => autocompleteState.feedback('down')} className="grid h-8 w-8 place-items-center rounded-[9px] text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"><LuThumbsDown className="h-4 w-4" /></button>
          {autocompleteState.bar.heading ? (
            <span className="ml-1 max-w-[220px] truncate rounded-[8px] bg-[#eff6ff] px-2 py-1 text-[12px] text-[#1d4ed8]" title="Accepting also starts this section">Next: {autocompleteState.bar.heading}</span>
          ) : null}
        </div>
      ) : null}
      {autocompleteOutOfCredits && areAIWritingSuggestionsEnabled && !isMobile ? (
        <div className="fixed bottom-12 right-16 z-[12550] w-[320px]">
          <CreditsUpsell feature="autocomplete" onDismiss={() => setAreAIWritingSuggestionsEnabled(false)} />
        </div>
      ) : null}
      {isParagraphReviewOpen ? (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/45 p-4" onClick={(event) => { if (event.target === event.currentTarget) setIsParagraphReviewOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="AI detection" className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">AI Detection Review</div>
                  <p className="mt-1 text-sm text-gray-500">
                    {scoredBlocks.filter((b) => b.score !== null && b.score >= AI_SCORE_FLAGGED_THRESHOLD).length} flagged
                    {' '}of {scoredBlocks.length} paragraphs
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsParagraphReviewOpen(false)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Dismiss
                </button>
              </div>
              {humanizeError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {humanizeError}
                </div>
              ) : null}
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {scoredBlocks.length === 0 ? (
                <p className="text-sm text-gray-500">No paragraphs to review. Add more content to the document.</p>
              ) : (
                <div className="space-y-3">
                  {scoredBlocks.map((block) => {
                    const isFlagged = block.score !== null && block.score >= AI_SCORE_FLAGGED_THRESHOLD;
                    const isHumanizingThis = humanizingBlockId === block.blockId;
                    const isOverLimit = humanizer.wordsLimit > 0 && block.wordCount > humanizer.wordsLimit;

                    return (
                      <div
                        key={block.blockId}
                        className={`rounded-2xl border p-4 ${
                          isFlagged ? 'border-[#fecaca] bg-[#fef2f2]' : 'border-[#e5e7eb] bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                              P{block.order + 1}
                            </span>
                            {block.score !== null ? (
                              <>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                    isFlagged ? 'bg-[#fee2e2] text-[#991b1b]' : 'bg-[#dcfce7] text-[#166534]'
                                  }`}
                                >
                                  AI {Math.round(block.score)}%
                                </span>
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                  Human {Math.max(0, 100 - Math.round(block.score))}%
                                </span>
                              </>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                                Too short to score
                              </span>
                            )}
                            {isFlagged ? (
                              <span className="rounded-full bg-[#fee2e2] px-2.5 py-1 text-[11px] font-medium text-[#991b1b]">
                                AI detected
                              </span>
                            ) : null}
                            {block.reasons.length > 0 ? (
                              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-500">
                                {block.reasons.join(', ')}
                              </span>
                            ) : null}
                          </div>

                          {block.isScannable && canEdit && canUseHumanizer ? (
                            <button
                              type="button"
                              onClick={() => void handleHumanizeBlock(block.blockId)}
                              disabled={isHumanizingThis || isOverLimit}
                              className="rounded-[8px] border border-[#dbeafe] px-3 py-1.5 text-[12px] font-semibold text-[var(--theme-primary-dark)] transition-colors hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isHumanizingThis ? 'Humanizing...' : 'Humanize'}
                            </button>
                          ) : null}
                        </div>

                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-800">
                          {block.text.length > 500 ? `${block.text.slice(0, 500)}...` : block.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
