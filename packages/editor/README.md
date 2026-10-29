# @videmak/editor

The Videmak academic editor as a React package: autocomplete with citations, @-cite, a Library with PDF chat, AI review, comments, suggestions, version history, real-time collaboration, and Word, LaTeX and PDF export. Built on BlockNote (ProseMirror) and Yjs. MIT licensed.

The package is the user interface. It talks to a Videmak server (`apps/server` in this repo, or your own implementation of the same API) for documents, AI, papers and sync.

## Use it in a React app

Until it is published to npm, use it from this repository as a workspace package (`"@videmak/editor": "workspace:*"`). It ships TypeScript source; Next.js needs `transpilePackages: ['@videmak/editor']`.

```tsx
import { VidemakEditor, VidemakEditorProvider, type VidemakEditorConfig } from '@videmak/editor';
import '@videmak/editor/styles.css';

const config: VidemakEditorConfig = {
  apiBase: 'https://write.example.edu',      // your Videmak server ('' = same origin)
  getToken: () => session.token,             // a token the server accepts, or null
  user: { id: 'u1', email: 'ada@example.edu', full_name: 'Ada Lovelace' },
  onRequireSignIn: () => router.push('/login'),
  onUpgrade: ({ message } = {}) => showPlans(message),
};

export function Writing() {
  return (
    <VidemakEditorProvider config={config}>
      <VidemakEditor />
    </VidemakEditorProvider>
  );
}
```

| Option | What it does |
| --- | --- |
| `apiBase` | Where the editor API lives. `''` means the page's own origin. |
| `realtimeUrl` | WebSocket address for live collaboration (default `${origin}/collab`). |
| `getToken` | Returns the signed-in person's token, or `null`. |
| `user`, `userLoading` | The person editing, for comments, presence and versions. |
| `onRequireSignIn` | Called when a signed-out visitor tries something that needs an account. |
| `onUpgrade` | Called when the server answers "payment required", with its message. |
| `onEvent` | Analytics hook. It never receives document text. |
| `editorPath`, `navLinks`, `renderNavigation` | Fit the editor into your app's routes and navigation. |

Also exported: the side panels (`AppToolDrawer`, `AppChatSideload`), `EditorToaster`, paper search (`searchPapers`, `lookupPaper`), Library helpers and chat streaming. See `src/index.ts`.

The fastest way to get every service behind the editor (papers, full text, AI, reviews, exports) is a [Videmak Cloud](../../docs/cloud-api.md) key on your server.
