'use client';

import { Toaster } from 'react-hot-toast';

/** Messages for the AI Editor (export, import, citation and humanizer errors) instead of browser pop-ups. */
export default function EditorToaster() {
  return <Toaster position="bottom-center" containerStyle={{ zIndex: 13000 }} />;
}
