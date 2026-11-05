import type { PlaybookOverview } from '@/lib/companion-v2/types';
import { Bullets, Card, KV } from './shared';

// Overview, in the prototype's order: Purpose, Context, Based on, Outcomes,
// Key insights, Maturity flags, Credits.
export default function OverviewTab({ overview }: { overview: PlaybookOverview }) {
  const o = overview ?? {};
  return (
    <div className="grid gap-[18px] md:grid-cols-2">
      <Card title="Purpose: what this playbook is for" wide>
        <KV entries={o.purpose ?? []} />
      </Card>
      <Card title="Context: where this playbook applies" wide>
        <KV entries={o.context ?? []} />
      </Card>
      <Card title="Based on" wide>
        <KV entries={o.based_on ?? []} />
      </Card>
      <Card title="Outcomes it can enable">
        <Bullets items={o.outcomes} />
      </Card>
      <Card title="Key insights across the jobs">
        <Bullets items={o.insights} />
      </Card>
      <Card title="Maturity flags" wide>
        <KV entries={o.maturity_flags ?? []} />
      </Card>
      <Card title="Credits" wide>
        <KV entries={o.credits ?? []} />
      </Card>
    </div>
  );
}
