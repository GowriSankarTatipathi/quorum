import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';
interface Screenshot {
  key: string;
  url: string;
  capturedAt: string;
  label: string;
}
export default async function EvidencePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let screenshots: Screenshot[];
  try {
    ({ screenshots } = await apiFetch<{ screenshots: Screenshot[] }>(
      `/v1/runs/${runId}/screenshots`,
    ));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401)
      redirect(`/signin?callbackUrl=/runs/${runId}/evidence`);
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
      <Link href={`/runs/${runId}`} className="text-sm underline">
        Back to run
      </Link>
      <h1 className="text-xl font-semibold">Browser evidence</h1>
      <p className="text-sm text-fg-muted">
        Saved views from this run. Open an image to inspect it at full size. Refresh this page if an
        image link has expired.
      </p>
      {!screenshots.length && <p>No saved screenshots are available for this run yet.</p>}
      {screenshots.map((shot) => (
        <figure key={shot.key} className="overflow-hidden rounded-lg border border-hairline">
          <figcaption className="border-b border-hairline px-4 py-3 text-sm">
            {shot.label} · {shot.capturedAt}
          </figcaption>
          <a href={shot.url} target="_blank" rel="noreferrer">
            <Image
              src={shot.url}
              alt={shot.label}
              width={1280}
              height={800}
              unoptimized
              className="h-auto w-full"
            />
          </a>
        </figure>
      ))}
    </div>
  );
}
