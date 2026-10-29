import { sql } from '../db.js';
import { EDIT_ROLES, type DocumentRow, type Role } from './access.js';

/** The document as the browser receives it (the shape @videmak/editor expects). */
export type MemberRow = {
  id: string;
  invite_email: string;
  display_name: string | null;
  role: Role;
  status: string;
  invite_sent: boolean;
  created_at: Date;
};

const ms = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : Date.now());

export function memberToDict(member: MemberRow) {
  return {
    id: String(member.id),
    displayName: member.display_name || member.invite_email,
    email: member.invite_email,
    role: member.role,
    addedAt: ms(member.created_at),
    status: member.status,
    inviteSent: member.invite_sent,
  };
}

/** Word settings for the browser; where the source Word file is kept stays on the server. */
export function publicWordSettings(settings: Record<string, any> | null) {
  if (!settings) return null;
  const { source, ...visible } = settings;
  return source ? { ...visible, source: { fileName: source.fileName, importedAt: source.importedAt } } : visible;
}

export function documentToRead(document: DocumentRow, members: MemberRow[], role: Role) {
  return {
    id: document.id,
    title: document.title,
    blocks: document.blocks || [],
    comments: document.comments || [],
    ownerUserId: document.owner_user_id,
    shareSettings: document.share_settings || {},
    activity: document.activity || [],
    members: members.map(memberToDict),
    currentUserRole: role,
    wordSettings: publicWordSettings(document.word_settings),
    canEdit: EDIT_ROLES.includes(role),
    canManageMembers: role === 'owner',
    createdAt: new Date(document.created_at).toISOString(),
    updatedAt: new Date(document.updated_at).toISOString(),
  };
}

export async function membersOf(documentId: string) {
  return sql<MemberRow[]>`
    select id, invite_email, display_name, role, status, invite_sent, created_at
    from document_members where document_id = ${documentId} order by created_at`;
}

