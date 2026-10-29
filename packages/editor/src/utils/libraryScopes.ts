import { getFolders, type FolderResponse } from './libraryApi';

/** Videmak has one personal Library per person; group libraries come later. */
export interface LibraryScope {
  id: string;
  label: string;
  groupLibraryId?: string;
  access?: string;
}

export interface ScopedFolder extends FolderResponse {
  scopeId: string;
  scopeLabel: string;
  group_library_id?: string | null;
}

export interface ScopedFolderResult {
  scopes: LibraryScope[];
  folders: ScopedFolder[];
}

export const PERSONAL_LIBRARY_SCOPE_ID = 'personal';

export async function getScopedLibraryFolders(): Promise<ScopedFolderResult> {
  const folders = await getFolders().catch(() => [] as FolderResponse[]);
  return {
    scopes: [{ id: PERSONAL_LIBRARY_SCOPE_ID, label: 'My library' }],
    folders: folders.map((folder) => ({ ...folder, scopeId: PERSONAL_LIBRARY_SCOPE_ID, scopeLabel: 'My library' })),
  };
}

export function documentScopeParams(scopeId: string | null, folderId?: string | null) {
  const isPersonal = !scopeId || scopeId === PERSONAL_LIBRARY_SCOPE_ID;
  return { folder_id: folderId || undefined, group_library_id: isPersonal ? undefined : scopeId };
}
