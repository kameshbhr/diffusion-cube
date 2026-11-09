import Link from 'next/link';
import type { ReactNode } from 'react';
import GenerateButton from './GenerateButton';
import { STATE_LABEL } from '../StateMarker';
import { formatWhen } from '@/lib/companion-v2/conversations';
import { DIGEST_PERIODS, FEW_USERS, type DigestPeriod, type DigestStats, type DigestView, type StateCounts } from '@/lib/companion-v2/digest';
import { JOB_STATES } from '@/lib/companion-v2/types';

interface Props {
  slug: string;
  playbookId: string;
  period: DigestPeriod;
  stats: DigestStats;
  states: StateCounts;
  jobNames: Record<string, string>;
  digest: { view: DigestView; generatedAt: string } | null;
}

const users = (n: number) => `${n} user${n === 1 ? '' : 's'}`;
const MAX_LINK_IDS = 100;
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDay = (d: string) => DAY.format(new Date(`${d}T00:00:00Z`));
const KIND_LABEL = { not_covered: 'Not covered', partly_covered: 'Partly covered', mixed: 'Not or partly covered' } as const;

// The contributor's Digest tab: numbers (SQL), then the AI-written digest for
// the selected period. Everyone is "users"; no names, emails or ids.
export default function DigestScreen({ slug, playbookId, period, stats, states, jobNames, digest }: Props) {
  const base = `/companion/${slug}`;
  const jobName = (code: string | null) => (code ? (jobNames[code] ?? 'A job no longer in the playbook') : null);
  // Capped so the link stays well within URL length limits.
  const viewLink = (ids: string[]) =>
    ids.length ? (
      <Link href={`${base}/conversations?ids=${ids.slice(0, MAX_LINK_IDS).join(',')}`} className="text-pb-accent hover:underline">
        {ids.length > MAX_LINK_IDS ? `View ${MAX_LINK_IDS} of ${ids.length} conversations` : 'View conversations'}
      </Link>
    ) : null;

  const view = digest?.view;
  // The banner describes what the digest rests on (after deletions); with no
  // digest yet, the period's numbers.
  const bannerPeople = view ? view.basis.people : stats.users_period;
  const bannerConvs = view ? view.basis.conversations : stats.conversations_period;

  const sections: { title: string; content: ReactNode }[] = view
    ? [
        {
          title: 'Themes',
          content: view.themes.length > 0 && (
            <ul className="space-y-3">
              {view.themes.map(({ item, convIds, people }, i) => (
                <Item key={i} meta={<Meta people={people} link={viewLink(convIds)} />}>
                  <p className="font-medium text-pb-ink">{item.title}</p>
                  <p className="text-pb-ink">{item.summary}</p>
                  {item.jobs.length > 0 && <JobChips jobs={item.jobs.map((j) => ({ code: j, name: jobName(j)! }))} />}
                </Item>
              ))}
            </ul>
          ),
        },
        {
          title: 'Unanswered questions',
          content: view.unanswered.length > 0 && (
            <ul className="space-y-3">
              {view.unanswered.map(({ item, convIds, people }, i) => (
                <Item
                  key={i}
                  meta={
                    <Meta people={people} link={viewLink(convIds)}>
                      <span>Asked {item.dates.map(shortDay).join(', ')}</span>
                    </Meta>
                  }
                >
                  <p className="font-medium text-pb-ink">{item.question}</p>
                  <p className="flex flex-wrap gap-1.5 text-xs">
                    <Tag>{KIND_LABEL[item.kind]}</Tag>
                    <Tag>{item.topic}</Tag>
                    {item.job && <Tag>{jobName(item.job)}</Tag>}
                  </p>
                </Item>
              ))}
            </ul>
          ),
        },
        {
          title: 'Where people got stuck',
          content: view.stuck.length > 0 && (
            <ul className="space-y-3">
              {view.stuck.map(({ item, convIds, people }, i) => {
                const counts = states[item.job] ?? {};
                return (
                  <Item
                    key={i}
                    meta={
                      <Meta people={item.state_only ? null : people} link={viewLink(convIds)}>
                        <span>
                          Now, till date:{' '}
                          {JOB_STATES.map((s) => `${STATE_LABEL[s]} ${counts[s] ?? 0}`).join(' · ')}
                        </span>
                      </Meta>
                    }
                  >
                    <p className="font-medium text-pb-ink">{jobName(item.job)}</p>
                    <p className="text-pb-ink">{item.observation}</p>
                  </Item>
                );
              })}
            </ul>
          ),
        },
        {
          title: 'Terms people asked about',
          content: view.terms.length > 0 && (
            <ul className="space-y-3">
              {view.terms.map(({ item, convIds, people }, i) => (
                <Item key={i} meta={<Meta people={people} link={viewLink(convIds)} />}>
                  <p className="font-medium text-pb-ink">{item.term}</p>
                  <p className="text-pb-ink">{item.observation}</p>
                </Item>
              ))}
            </ul>
          ),
        },
        ...(['complaints', 'working'] as const).map((key) => ({
          title: key === 'complaints' ? 'Complaints about Cube or the playbook' : 'What’s working',
          content: view[key].length > 0 && (
            <ul className="space-y-3">
              {view[key].map(({ item, convIds, people }, i) => (
                <Item key={i} meta={<Meta people={people} link={viewLink(convIds)} />}>
                  <p className="text-xs">
                    <Tag>{item.about === 'cube' ? 'About Cube' : 'About the playbook'}</Tag>
                  </p>
                  <p className="text-pb-ink">{item.summary}</p>
                </Item>
              ))}
            </ul>
          ),
        })),
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header: period, generated time, (re)generate */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-pb-line bg-pb-surface p-0.5 text-sm">
            {DIGEST_PERIODS.map((d) => (
              <Link
                key={d}
                href={`${base}/digest${d === 7 ? '' : `?days=${d}`}`}
                aria-current={d === period ? 'page' : undefined}
                className={`rounded-md px-3 py-1 transition ${
                  d === period ? 'bg-pb-accent-soft font-medium text-pb-accent' : 'text-pb-muted hover:text-pb-ink'
                }`}
              >
                Last {d} days
              </Link>
            ))}
          </div>
          <p className="text-xs text-pb-muted">
            {digest ? `Generated on ${formatWhen(digest.generatedAt)}` : `No digest for the last ${period} days yet.`}
          </p>
        </div>
        <GenerateButton key={period} playbookId={playbookId} period={period} label={digest ? 'Regenerate' : 'Generate digest'} />
      </div>

      {/* Numbers, computed in SQL when the tab opens */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Users" total={stats.users_total} recent={stats.users_period} period={period} />
        <Stat label="Conversations" total={stats.conversations_total} recent={stats.conversations_period} period={period} />
        <div className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
          <p className="text-xs text-pb-muted">Most discussed jobs, till date</p>
          {stats.jobs.length ? (
            <ol className="mt-1.5 space-y-1 text-sm">
              {stats.jobs.slice(0, 5).map((j) => (
                <li key={j.job} className="flex justify-between gap-3">
                  <span className="text-pb-ink">{j.name}</span>
                  <span className="whitespace-nowrap text-xs text-pb-muted">
                    {j.conversations} conv.
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-sm text-pb-muted">No jobs discussed yet.</p>
          )}
        </div>
      </div>
      <p className="-mt-3 text-[11px] text-pb-muted">
        Users and conversations count only people who wrote to Cube; contributors’ own chats aren’t counted. A job counts once per
        conversation in which Cube’s answer was about it.
      </p>

      <p className="rounded-xl bg-pb-accent-soft px-4 py-2.5 text-sm text-pb-ink">
        Based on {users(bannerPeople)} and {bannerConvs} conversation{bannerConvs === 1 ? '' : 's'} in the last {period} days.
        {bannerPeople < FEW_USERS && ' Too few users to see patterns.'}
        {view && view.basis.messagesTotal > view.basis.messagesUsed &&
          ` Only the most recent ${view.basis.messagesUsed} of ${view.basis.messagesTotal} messages were read.`}
      </p>

      {view && view.summary.length > 0 && (
        <section className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
          <h2 className="text-sm font-semibold text-pb-ink">Summary</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-pb-ink">
            {view.summary.map((b, i) => (
              <li key={i}>
                {b.text}
                {/* A bullet resting only on journey-state counts has no conversations: no user count. */}
                {b.people > 0 && <span className="text-xs text-pb-muted"> ({users(b.people)})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections
        .filter((s) => s.content)
        .map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 text-sm font-semibold text-pb-ink">{s.title}</h2>
            {s.content}
          </section>
        ))}

      <p className="border-t border-pb-line-soft pt-4 text-sm">
        <Link href={`${base}/conversations`} className="text-pb-accent hover:underline">
          Browse all conversations →
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, total, recent, period }: { label: string; total: number; recent: number; period: number }) {
  return (
    <div className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
      <p className="text-xs text-pb-muted">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-pb-ink">{total}</span>
        <span className="text-xs text-pb-muted">
          {recent} in the last {period} days
        </span>
      </p>
    </div>
  );
}

function Item({ children, meta }: { children: ReactNode; meta: ReactNode }) {
  return (
    <li className="space-y-1 rounded-xl border border-pb-line bg-pb-surface px-4 py-3 text-sm leading-relaxed">
      {children}
      {meta}
    </li>
  );
}

function Meta({ people, link, children }: { people: number | null; link: ReactNode; children?: ReactNode }) {
  const parts = [people != null && <span key="p">{users(people)}</span>, children, link].filter(Boolean);
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-pb-muted">
      {parts.map((p, i) => (
        <span key={i} className="flex gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </p>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full bg-pb-accent-soft px-2 py-0.5 text-pb-accent">{children}</span>;
}

function JobChips({ jobs }: { jobs: { code: string; name: string }[] }) {
  return (
    <p className="flex flex-wrap gap-1.5 text-xs">
      {jobs.map((j) => (
        <Tag key={j.code}>{j.name}</Tag>
      ))}
    </p>
  );
}
