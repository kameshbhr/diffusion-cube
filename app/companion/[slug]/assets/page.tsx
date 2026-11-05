import Placeholder from '@/components/companion-v2/Placeholder';
import { requireContributor } from '@/lib/companion-v2/server';

export default async function AssetsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireContributor(slug);
  return <Placeholder title="Assets" body="Upload files or add links, describe them and tag them to jobs. Coming in a later build step." />;
}
