import type { PlaybookOverview } from '@/lib/companion-v2/types';
import type { OverviewSection } from './edit/forms';
import { Bullets, Card, KV } from './shared';

// Overview, in the prototype's order: Purpose, Context, Based on, Outcomes,
// Key insights, Maturity flags, Credits.
export default function OverviewTab({
  overview,
  onEdit,
}: {
  overview: PlaybookOverview;
  onEdit?: (section: OverviewSection) => void;
}) {
  const o = overview ?? {};
  const e = (s: OverviewSection) => (onEdit ? () => onEdit(s) : undefined);
  return (
    <div className="grid gap-[18px] md:grid-cols-2">
      <Card title="Purpose: what this playbook is for" wide onEdit={e('purpose')}>
        <KV entries={o.purpose ?? []} />
      </Card>
      <Card title="Context: where this playbook applies" wide onEdit={e('context')}>
        <KV entries={o.context ?? []} />
      </Card>
      <Card title="Based on" wide onEdit={e('based_on')}>
        <KV entries={o.based_on ?? []} />
      </Card>
      <Card title="Outcomes it can enable" onEdit={e('outcomes')}>
        <Bullets items={o.outcomes} />
      </Card>
      <Card title="Key insights across the jobs" onEdit={e('insights')}>
        <Bullets items={o.insights} />
      </Card>
      <Card title="Maturity flags" wide onEdit={e('maturity_flags')}>
        <KV entries={o.maturity_flags ?? []} />
      </Card>
      <Card title="Credits" wide onEdit={e('credits')}>
        <KV entries={o.credits ?? []} />
      </Card>
    </div>
  );
}
