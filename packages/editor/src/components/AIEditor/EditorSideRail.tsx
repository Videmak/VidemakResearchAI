'use client';

import type React from 'react';
import { LuCircleHelp, LuGlobe, LuLibrary, LuListTree, LuMessageSquare, LuPenLine, LuShieldCheck, LuSparkles } from 'react-icons/lu';
import type { AssistantTab } from './assistant/AssistantPanel';
import { navLink } from '../../runtime';

type EditorSideRailProps = {
  isOutlineVisible: boolean;
  onToggleOutline: () => void;
  activeTab: AssistantTab | null;
  onToggleTab: (tab: AssistantTab) => void;
  onWriteWithAI?: () => void;
  commentCount: number;
};

function RailButton({ label, onClick, active, accent, children, badge }: {
  label: string;
  onClick: () => void;
  active?: boolean;
  accent?: boolean;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`relative grid h-10 w-10 place-items-center rounded-[10px] transition-colors ${
        active ? 'bg-[#eff6ff] text-[var(--theme-primary-dark,#1d4ed8)]' : accent ? 'text-[var(--theme-primary,#2563eb)] hover:bg-[#f1f5f9]' : 'text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
      }`}
    >
      {children}
      {badge ? (
        <span className="absolute right-0 top-0 min-w-[16px] rounded-full bg-[#f59e0b] px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The document's tool rail on the right (tablet and desktop), as in Google Docs: each tool
 * opens beside the page and closes again from the same button.
 */
export default function EditorSideRail({ isOutlineVisible, onToggleOutline, activeTab, onToggleTab, onWriteWithAI, commentCount }: EditorSideRailProps) {
  return (
    <nav aria-label="Document tools" className="ai-editor-print-hidden hidden w-[52px] shrink-0 flex-col items-center gap-1 border-l border-[#eef2f6] bg-white pt-3 md:flex">
      <RailButton label={isOutlineVisible ? 'Hide outline' : 'Outline'} active={isOutlineVisible} onClick={onToggleOutline}>
        <LuListTree className="h-[19px] w-[19px]" />
      </RailButton>
      <RailButton label="AI Chat" accent active={activeTab === 'chat'} onClick={() => onToggleTab('chat')}>
        <LuSparkles className="h-[19px] w-[19px]" />
      </RailButton>
      <RailButton label="Comments" active={activeTab === 'comments'} onClick={() => onToggleTab('comments')} badge={commentCount}>
        <LuMessageSquare className="h-[19px] w-[19px]" />
      </RailButton>
      <RailButton label="Review" active={activeTab === 'review'} onClick={() => onToggleTab('review')}>
        <LuShieldCheck className="h-[19px] w-[19px]" />
      </RailButton>
      <RailButton label="Library" active={activeTab === 'library'} onClick={() => onToggleTab('library')}>
        <LuLibrary className="h-[19px] w-[19px]" />
      </RailButton>
      <RailButton label="Find papers" active={activeTab === 'papers'} onClick={() => onToggleTab('papers')}>
        <LuGlobe className="h-[19px] w-[19px]" />
      </RailButton>
      {onWriteWithAI ? (
        <RailButton label="Write with AI" onClick={onWriteWithAI}>
          <LuPenLine className="h-[19px] w-[19px]" />
        </RailButton>
      ) : null}
      <div className="my-1 h-px w-6 bg-[#eef2f6]" />
      <RailButton label="Help" onClick={() => window.open(navLink('help'), '_blank', 'noopener')}>
        <LuCircleHelp className="h-[19px] w-[19px]" />
      </RailButton>
    </nav>
  );
}
