'use client';

import { LuHistory } from 'react-icons/lu';
import { Card, EmptyState } from '@/components/app/ui';
import { SectionHeader } from './SettingsSection';
import { when, words, type Overview } from './adminTypes';

/** Admin › Activity: who changed what (setting values are never recorded). */
export function ActivitySection({ overview }: { overview: Overview | null }) {
  return (
    <section>
      <SectionHeader icon={LuHistory} title="Activity" subtitle="Last 20 admin changes. Values are never recorded." />
      <Card className="overflow-hidden">
        {!overview ? <p className="px-5 py-6 text-[13.5px] text-muted">Loading…</p> : overview.audit.length === 0 ? <EmptyState title="No changes yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead><tr className="bg-soft text-[12px] text-muted"><th className="px-5 py-2.5 font-medium">When</th><th className="py-2.5 pr-3 font-medium">Who</th><th className="py-2.5 pr-3 font-medium">Change</th><th className="py-2.5 pr-5 font-medium">Item</th></tr></thead>
              <tbody>
                {overview.audit.map((entry, index) => (
                  <tr key={index} className="h-12 border-t border-line-2 text-[13.5px]">
                    <td className="whitespace-nowrap px-5 text-muted">{when(entry.created_at)}</td>
                    <td className="max-w-[220px] truncate pr-3">{entry.email || '—'}</td>
                    <td className="pr-3 font-medium">{words(entry.action)}</td>
                    <td className="max-w-[240px] truncate pr-5 font-mono text-[12.5px] text-ink-2">{entry.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
