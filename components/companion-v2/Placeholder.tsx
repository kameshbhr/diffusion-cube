// Stand-in for a workspace screen that a later build slice fills in.
export default function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-dashed border-pb-line bg-pb-surface px-6 py-10 text-center">
      <h2 className="font-serif text-lg font-bold text-pb-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-pb-muted">{body}</p>
    </section>
  );
}
