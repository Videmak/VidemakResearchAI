import '@mantine/core/styles.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '@videmak/editor/styles.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Documents', robots: { index: false, follow: false } };

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
