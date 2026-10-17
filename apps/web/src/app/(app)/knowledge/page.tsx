import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnowledgeAssistant } from '@/components/knowledge-assistant';
import { auth } from '@/server/auth';

export const metadata: Metadata = { title: 'Knowledge — QUORUM' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const session = await auth();
  if (!session?.user.id) redirect('/signin?callbackUrl=/knowledge');
  return <KnowledgeAssistant />;
}
