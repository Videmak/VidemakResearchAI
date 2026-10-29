/**
 * @videmak/editor — an academic writing editor with citations, AI assistance and
 * real-time collaboration. Wrap it in <VidemakEditorProvider config={...}> and render
 * <VidemakEditor />; the provider config connects it to your API, accounts and billing.
 */
export { default as VidemakEditor } from './components/AIEditor/AIEditorWorkspace';
export { VidemakEditorProvider, useEditorConfig, getEditorConfig } from './runtime';
export type { VidemakEditorConfig, VidemakUser } from './runtime';
export { useMobileTabBarHidden } from './lib/mobileShell';
export { AppToolDrawer, AppChatSideload } from './components/AIEditor/AppSideloads';
export { default as EditorToaster } from './components/AIEditor/EditorToaster';
export { toggleSideload, showSideload, closeSideloadDrawer, closeSideloadChat, setSideloadMenu, useSideloads } from './lib/sideloads';
export type { SideloadTool, SideloadDrawer } from './lib/sideloads';
export { searchPapers, lookupPaper, streamChat, listChats, getChat, deleteChat, paperAuthorsLabel } from './lib/aiEditor/assistApi';
export type { Paper } from './lib/aiEditor/assistApi';
export { getDocuments, uploadDocument, getFolders } from './utils/libraryApi';
export type { LibraryDocumentResponse } from './utils/libraryApi';
export { importPaper } from './utils/articlesApi';
