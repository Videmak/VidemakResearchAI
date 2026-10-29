import { HTTPException } from 'hono/http-exception';
import { sql } from '../db.js';
import type { AuthUser } from '../auth.js';

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export const EDIT_ROLES: Role[] = ['owner', 'editor'];
export const COMMENT_ROLES: Role[] = ['owner', 'editor', 'commenter'];

export type DocumentRow = {
  id: string;
  owner_user_id: string;
  title: string;
  blocks: unknown[];
  comments: unknown[];
  share_settings: Record<string, any>;
  activity: unknown[];
  word_settings: Record<string, any> | null;
  word_count: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * Who may open a document and how: the owner, an active member, or anyone with the
 * link when link sharing is on (signed-in people get the link's role, others may only view).
 */
export async function resolveAccess(documentId: string, user: AuthUser | null): Promise<{ document: DocumentRow; role: Role }> {
  const [document] = await sql<DocumentRow[]>`
    select id, owner_user_id, title, blocks, comments, share_settings, activity, word_settings, word_count, created_at, updated_at
    from documents where id = ${documentId}`;
  if (!document) throw new HTTPException(404, { message: 'Document not found' });
  if (user && document.owner_user_id === user.id) return { document, role: 'owner' };
  if (user) {
    const [member] = await sql<{ role: Role }[]>`
      select role from document_members
      where document_id = ${documentId} and status = 'active' and (user_id = ${user.id} or lower(invite_email) = ${user.email})
      limit 1`;
    if (member) return { document, role: member.role };
  }
  const share = document.share_settings || {};
  if (share.isLinkSharingEnabled) {
    const linkRole: Role = ['editor', 'commenter', 'viewer'].includes(share.defaultAccessRole) ? share.defaultAccessRole : 'viewer';
    return { document, role: user ? linkRole : 'viewer' };
  }
  throw new HTTPException(user ? 403 : 404, { message: user ? 'You do not have access to this document.' : 'Document not found' });
}

export function displayName(user: Pick<AuthUser, 'email' | 'full_name'>) {
  return user.full_name || user.email.split('@')[0] || 'User';
}
