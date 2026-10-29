'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { LuCheck, LuGlobe, LuLink, LuLock, LuX } from 'react-icons/lu';
import { editorPath } from '../../runtime';
import type {
  AIEditorAccessRole,
  AIEditorActivityEntry,
  AIEditorCollaborator,
  AIEditorDocumentMember,
  AIEditorDocumentSnapshot,
} from '../../types/ai-editor';

type ShareRole = Exclude<AIEditorAccessRole, 'owner'>;

const ROLES: { value: ShareRole; label: string; verb: string }[] = [
  { value: 'viewer', label: 'Viewer', verb: 'view' },
  { value: 'commenter', label: 'Commenter', verb: 'comment' },
  { value: 'editor', label: 'Editor', verb: 'edit' },
];

const SELECT = 'h-8 rounded-lg bg-transparent px-1.5 text-[13px] font-medium text-[#334155] outline-none hover:bg-[#f1f5f9] focus:bg-[#f1f5f9] disabled:cursor-default disabled:hover:bg-transparent';

type AIEditorShareDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  documentSnapshot: AIEditorDocumentSnapshot | null;
  collaborators: AIEditorCollaborator[];
  members: AIEditorDocumentMember[];
  activity: AIEditorActivityEntry[];
  currentUserDisplayName: string;
  currentUserEmail?: string | null;
  isOwner: boolean;
  onUpdateShareSettings: (next: {
    isLinkSharingEnabled?: boolean;
    defaultAccessRole?: ShareRole;
  }) => void;
  onAddMember: (member: Omit<AIEditorDocumentMember, 'id' | 'addedAt'>) => void;
  onUpdateMemberRole: (memberId: string, role: ShareRole) => void;
  onRemoveMember: (memberId: string) => void;
  onUpdateSessionDisplayName: (displayName: string) => void;
};

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eff6ff] text-[13px] font-semibold text-[#1d4ed8]" aria-hidden="true">
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}

/** Share a document: invite people by email, set their role, and choose who the link opens for. */
export default function AIEditorShareDialog({
  isOpen,
  onClose,
  documentSnapshot,
  members,
  currentUserDisplayName,
  currentUserEmail,
  isOwner,
  onUpdateShareSettings,
  onAddMember,
  onUpdateMemberRole,
  onRemoveMember,
}: AIEditorShareDialogProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ShareRole>('editor');
  const [copied, setCopied] = useState(false);

  const shareLink = useMemo(() => {
    if (!documentSnapshot || typeof window === 'undefined') return '';
    const url = new URL(`${window.location.origin}${editorPath()}`);
    url.searchParams.set('doc', documentSnapshot.id);
    return url.toString();
  }, [documentSnapshot]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!isOpen || !documentSnapshot) return null;

  const { isLinkSharingEnabled, defaultAccessRole } = documentSnapshot.share;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  const invite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    onAddMember({ displayName: email, email, role: inviteRole });
    setInviteEmail('');
  };

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy the share link:', error);
    }
  };

  const linkRole = ROLES.find((role) => role.value === defaultAccessRole) ?? ROLES[0];

  return (
    <div role="dialog" aria-modal="true" aria-label="Share" className="fixed inset-0 z-[13000] flex items-end justify-center bg-[rgba(15,23,42,0.35)] sm:items-center sm:p-4">
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-[500px] flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)] sm:rounded-[16px]">
        <div className="flex items-center gap-3 px-5 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[#0f172a]">Share “{documentSnapshot.title || 'Untitled document'}”</h2>
          <button type="button" onClick={onClose} aria-label="Close share dialog" className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]">
            <LuX className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {isOwner ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                invite();
              }}
              className="flex items-center gap-1 rounded-[10px] border border-[#e2e8f0] py-1 pl-3 pr-1 focus-within:border-[var(--theme-primary,#2563eb)] focus-within:shadow-[0_0_0_3px_#eff6ff]"
            >
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Add people by email"
                aria-label="Email"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[14px] text-[#0f172a] outline-none placeholder:text-[#94a3b8]"
              />
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as ShareRole)} aria-label="Role" className={SELECT}>
                {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              <button type="submit" disabled={!emailValid} className="h-8 rounded-lg bg-[var(--theme-primary,#2563eb)] px-3 text-[13px] font-semibold text-white hover:bg-[#1d4ed8] disabled:bg-[#e2e8f0] disabled:text-[#94a3b8]">
                Invite
              </button>
            </form>
          ) : null}

          <h3 className="mb-1 mt-4 text-[12.5px] font-medium text-[#94a3b8]">People with access</h3>
          <ul>
            <li className="flex items-center gap-3 py-1.5">
              <Avatar name={currentUserDisplayName} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-[#0f172a]">{currentUserDisplayName} <span className="font-normal text-[#94a3b8]">(you)</span></div>
                {currentUserEmail ? <div className="truncate text-[12.5px] text-[#64748b]">{currentUserEmail}</div> : null}
              </div>
              <span className="pr-1.5 text-[13px] text-[#94a3b8]">{isOwner ? 'Owner' : null}</span>
            </li>
            {members
              .filter((member) => member.email.toLowerCase() !== (currentUserEmail || '').toLowerCase())
              .map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-1.5">
                  <Avatar name={member.displayName || member.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#0f172a]">{member.displayName || member.email}</div>
                    {member.displayName && member.displayName !== member.email ? <div className="truncate text-[12.5px] text-[#64748b]">{member.email}</div> : null}
                  </div>
                  {isOwner ? (
                    <>
                      <select value={member.role} onChange={(event) => onUpdateMemberRole(member.id, event.target.value as ShareRole)} aria-label={`Role for ${member.email}`} className={SELECT}>
                        {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <button type="button" onClick={() => onRemoveMember(member.id)} aria-label={`Remove ${member.email}`} title="Remove" className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#b91c1c]">
                        <LuX className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <span className="pr-1.5 text-[13px] text-[#94a3b8]">{ROLES.find((role) => role.value === member.role)?.label}</span>
                  )}
                </li>
              ))}
          </ul>

          <h3 className="mb-1 mt-4 text-[12.5px] font-medium text-[#94a3b8]">General access</h3>
          <div className="flex items-center gap-3 py-1.5">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${isLinkSharingEnabled ? 'bg-[#f0fdf4] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`} aria-hidden="true">
              {isLinkSharingEnabled ? <LuGlobe className="h-4 w-4" /> : <LuLock className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <select
                value={isLinkSharingEnabled ? 'link' : 'restricted'}
                disabled={!isOwner}
                onChange={(event) => onUpdateShareSettings({ isLinkSharingEnabled: event.target.value === 'link' })}
                aria-label="General access"
                className={`${SELECT} -ml-1.5 text-[14px] text-[#0f172a]`}
              >
                <option value="restricted">Restricted</option>
                <option value="link">Anyone with the link</option>
              </select>
              <div className="text-[12.5px] text-[#64748b]">
                {isLinkSharingEnabled ? `Anyone with the link can ${linkRole.verb}` : 'Only people added can open'}
              </div>
            </div>
            {isLinkSharingEnabled ? (
              <select value={defaultAccessRole} disabled={!isOwner} onChange={(event) => onUpdateShareSettings({ defaultAccessRole: event.target.value as ShareRole })} aria-label="Link role" className={SELECT}>
                {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#f1f5f9] px-5 py-3">
          <button type="button" onClick={() => void copyLink()} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-[var(--theme-primary,#2563eb)] hover:bg-[#eff6ff]">
            {copied ? <LuCheck className="h-4 w-4" /> : <LuLink className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-lg bg-[var(--theme-primary,#2563eb)] px-4 text-[13.5px] font-semibold text-white hover:bg-[#1d4ed8]">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
