import { GoalComposer } from '@/components/goal-composer';
export const dynamic = 'force-dynamic';
/** GET only prepares a draft. Creation always requires an explicit form POST. */
export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto flex max-w-3xl justify-center px-5 py-12">
      <GoalComposer initialGoal={typeof params.goal === 'string' ? params.goal : ''} />
    </div>
  );
}
