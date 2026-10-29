'use client';

import React from 'react';
import { defaultInlineContentSpecs, type BlockNoteEditor } from '@blocknote/core';
import { createReactInlineContentSpec, SuggestionMenuController } from '@blocknote/react';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import type { AIEditorDocumentMember } from '../../types/ai-editor';
import { sanitize } from '../../helpers/sanitize';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function getMentionColor(seed: string) {
  const palette = ['#1a73e8', '#188038', '#c5221f', '#7c4dff', '#e37400', '#00639b'];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return palette[Math.abs(hash) % palette.length];
}

export const aiEditorMentionInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'aiMention',
    content: 'none',
    propSchema: {
      memberId: { default: '' },
      displayName: { default: '' },
      email: { default: '' },
      role: { default: 'viewer' },
      color: { default: '#1a73e8' },
    },
  },
  {
    parse: (element) => {
      if (element.dataset.inlineContentType !== 'aiMention') {
        return undefined;
      }

      return {
        memberId: element.getAttribute('data-member-id') ?? '',
        displayName: element.getAttribute('data-display-name') ?? '',
        email: element.getAttribute('data-email') ?? '',
        role: element.getAttribute('data-role') ?? 'viewer',
        color: element.getAttribute('data-color') ?? '#1a73e8',
      };
    },
    render: ({ inlineContent }) => {
      const label = inlineContent.props.displayName || inlineContent.props.email || 'Mention';

      return (
        <span
          contentEditable={false}
          data-member-id={inlineContent.props.memberId}
          data-display-name={inlineContent.props.displayName}
          data-email={inlineContent.props.email}
          data-role={inlineContent.props.role}
          data-color={inlineContent.props.color}
          className="inline-flex items-center rounded-full border px-2 py-0.5 align-middle text-[0.9em] font-medium"
          style={{
            borderColor: `${inlineContent.props.color}33`,
            backgroundColor: `${inlineContent.props.color}1a`,
            color: inlineContent.props.color,
          }}
          title={`${label} • ${inlineContent.props.email} • ${inlineContent.props.role}`}
        >
          @{label}
        </span>
      );
    },
  },
);

export const aiEditorCitationInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'aiCitation',
    content: 'none',
    propSchema: {
      citationId: { default: '' },
      base64: { default: '' },
      displayText: { default: '(Citation)' },
      bibliography: { default: '' },
      style: { default: 'apa' },
      url: { default: '' },
      // Per-citation choices: narrative form, page/locator, prefix and suffix.
      mode: { default: '' },
      locator: { default: '' },
      prefix: { default: '' },
      suffix: { default: '' },
    },
  },
  {
    parse: (element) => {
      if (element.dataset.inlineContentType !== 'aiCitation') {
        return undefined;
      }

      return {
        citationId: element.getAttribute('data-citation-id') ?? '',
        base64: element.getAttribute('data-citation') ?? '',
        displayText: element.getAttribute('data-display-text') ?? element.textContent ?? '(Citation)',
        bibliography: element.getAttribute('data-bibliography') ?? '',
        style: element.getAttribute('data-style') ?? 'apa',
        url: element.getAttribute('data-url') ?? '',
        mode: element.getAttribute('data-mode') ?? '',
        locator: element.getAttribute('data-locator') ?? '',
        prefix: element.getAttribute('data-prefix') ?? '',
        suffix: element.getAttribute('data-suffix') ?? '',
      };
    },
    render: ({ inlineContent }) => {
      const bibliography = inlineContent.props.bibliography || inlineContent.props.displayText;

      return (
        <span
          contentEditable={false}
          data-citation-id={inlineContent.props.citationId}
          data-citation={inlineContent.props.base64}
          data-display-text={inlineContent.props.displayText}
          data-bibliography={inlineContent.props.bibliography}
          data-style={inlineContent.props.style}
          data-url={inlineContent.props.url}
          data-mode={inlineContent.props.mode || undefined}
          data-locator={inlineContent.props.locator || undefined}
          data-prefix={inlineContent.props.prefix || undefined}
          data-suffix={inlineContent.props.suffix || undefined}
          className="citation-token inline-flex items-center rounded-sm border-b border-[var(--theme-primary-border)] bg-[var(--theme-primary-tint)] px-1 align-middle text-[0.95em] font-medium text-[var(--theme-primary-dark)]"
          title={bibliography}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDoubleClick={() => {
            if (inlineContent.props.url) {
              window.open(inlineContent.props.url, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          {inlineContent.props.displayText}
        </span>
      );
    },
  },
);

export const aiMathInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'aiMath',
    content: 'none',
    propSchema: {
      latex: { default: '' },
      displayMode: { default: 'false' },
    },
  },
  {
    parse: (element) => {
      if (element.dataset.inlineContentType !== 'aiMath') {
        return undefined;
      }
      return {
        latex: element.getAttribute('data-latex') ?? '',
        displayMode: element.getAttribute('data-display-mode') ?? 'false',
      };
    },
    render: ({ inlineContent }) => {
      const { latex, displayMode: dm } = inlineContent.props;
      const isBlock = dm === 'true';

      let rendered = '';
      if (latex) {
        try {
          rendered = katex.renderToString(latex, { throwOnError: false, displayMode: isBlock });
        } catch {
          rendered = `<span style="color:#c00">[Math: ${latex}]</span>`;
        }
      }

      return (
        <span
          contentEditable={false}
          data-latex={latex}
          data-display-mode={String(isBlock)}
          dangerouslySetInnerHTML={{ __html: sanitize(rendered) }}
          className={isBlock ? 'block text-center my-3 py-2 overflow-x-auto' : 'inline-block align-middle'}
        />
      );
    },
  },
);

export const aiEditorInlineContentSpecs = {
  ...defaultInlineContentSpecs,
  aiMention: aiEditorMentionInlineContentSpec,
  aiCitation: aiEditorCitationInlineContentSpec,
  aiMath: aiMathInlineContentSpec,
};

function buildMentionItems(
  editor: BlockNoteEditor<any, any, any>,
  members: AIEditorDocumentMember[],
  query: string,
): DefaultReactSuggestionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const uniqueMembers = members.filter(
    (member, index, collection) =>
      collection.findIndex((candidate) => candidate.email.toLowerCase() === member.email.toLowerCase()) === index,
  );

  return uniqueMembers
    .filter((member) => {
      if (!normalizedQuery) {
        return true;
      }

      return [member.displayName, member.email, member.role].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      );
    })
    .slice(0, 8)
    .map((member) => {
      const color = getMentionColor(member.email);
      const initials =
        member.displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('') || member.email.slice(0, 2).toUpperCase();

      return {
        title: member.displayName,
        subtext: `${member.email} • ${member.role}`,
        group: 'Shared people',
        icon: (
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {initials}
          </span>
        ),
        onItemClick: () => {
          editor.insertInlineContent([
            {
              type: 'aiMention',
              props: {
                memberId: member.id,
                displayName: member.displayName,
                email: member.email,
                role: member.role,
                color,
              },
            },
            ' ',
          ]);
        },
      };
    });
}

export function AIEditorMentionMenu({
  editor,
  members,
  enabled,
}: {
  editor: BlockNoteEditor<any, any, any>;
  members: AIEditorDocumentMember[];
  enabled: boolean;
}) {
  if (!enabled || members.length === 0) {
    return null;
  }

  return (
    <SuggestionMenuController
      triggerCharacter="@"
      minQueryLength={0}
      getItems={async (query) => buildMentionItems(editor, members, query)}
    />
  );
}
