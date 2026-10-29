'use client';

import { useEffect } from 'react';
import { useEditorConfig } from '../../runtime';

type AuthModalProps = { isOpen: boolean; onClose: () => void; initialMode?: string; reason?: string; module?: string };

/** Hands sign-in to the host app instead of showing an editor-owned form. */
export default function AuthModal({ isOpen, onClose, reason }: AuthModalProps) {
  const { onRequireSignIn } = useEditorConfig();
  useEffect(() => {
    if (!isOpen) return;
    onRequireSignIn?.(reason);
    onClose();
  }, [isOpen, onClose, onRequireSignIn, reason]);
  return null;
}
