'use client';

import { useEffect } from 'react';
import { useEditorConfig } from '../runtime';

/** Hands upgrades to the host app (its own pricing and checkout). */
export default function BuyCreditsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; [key: string]: unknown }) {
  const { onUpgrade } = useEditorConfig();
  useEffect(() => {
    if (!isOpen) return;
    onUpgrade?.({ reason: 'credits' });
    onClose();
  }, [isOpen, onClose, onUpgrade]);
  return null;
}
