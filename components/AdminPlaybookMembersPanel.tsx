'use client';

import { useMemo, useState } from 'react';

export interface AdminPlaybookRow {
  id: string;
  title: string;
  slug: string;
  contributorIds: string[];
}

export interface AdminUserOption {
  id: string;
  email: string;
}

// Cube 2.0: assign contributors per playbook. Adopters join playbooks
// themselves, so only contributors are managed here.
export default function AdminPlaybookMembersPanel({
  initialPlaybooks,
  users,
}: {
  initialPlaybooks: AdminPlaybookRow[];
  users: AdminUserOption[];
}) {
  const [playbooks, setPlaybooks] = useState(initialPlaybooks);
  const [selectedId, setSelectedId] = useState(initialPlaybooks[0]?.id ?? '');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailById = useMemo(() => new Map(users.map((u) => [u.id, u.email])), [users]);
  const selected = playbooks.find((p) => p.id === selectedId);

  if (playbooks.length === 0) {
    return <p className="text-sm text-ink-soft">No playbooks yet. Seed one with scripts/cube2/seed-playbook.mjs.</p>;
  }

  async function change(userId: string, action: 'add' | 'remove') {
    if (!selected) return;
    if (
      action === 'remove' &&
      !window.confirm(
        `Remove ${emailById.get(userId) ?? 'this user'} as a contributor to "${selected.title}"? Their own conversations with Cube in this playbook and their job markers are deleted too. They can open the playbook again as an adopter.`
      )
    )
      return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/playbook-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbook_id: selected.id, user_id: userId, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not update contributors.');
        return;
      }
      setPlaybooks((prev) =>
        prev.map((p) =>
          p.id !== selected.id
            ? p
            : {
                ...p,
                contributorIds:
                  action === 'add'
                    ? [...new Set([...p.contributorIds, userId])]
                    : p.contributorIds.filter((id) => id !== userId),
              }
        )
      );
      if (action === 'add') setEmail('');
    } finally {
      setPending(false);
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const match = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!match) {
      setError('No signed-up user has that email.');
      return;
    }
    change(match.id, 'add');
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4">
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
        Playbook
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setError(null);
          }}
          className="rounded-lg border border-navy/15 bg-white px-2 py-1.5 text-sm"
        >
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4">
        {selected && selected.contributorIds.length > 0 ? (
          <ul className="divide-y divide-navy/5">
            {selected.contributorIds.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-ink">{emailById.get(id) ?? id}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => change(id, 'remove')}
                  className="flex-shrink-0 text-xs text-ink-soft transition hover:text-coral disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">No contributors yet.</p>
        )}
      </div>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="email"
          list="playbook-member-emails"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email of a signed-up user"
          className="min-w-0 flex-1 rounded-lg border border-navy/15 px-3 py-1.5 text-sm"
          required
        />
        <datalist id="playbook-member-emails">
          {users.map((u) => (
            <option key={u.id} value={u.email} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-50"
        >
          Add as contributor
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-coral">{error}</p>}
    </div>
  );
}
