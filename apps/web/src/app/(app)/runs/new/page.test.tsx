import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NewRunPage from './page';
vi.mock('@/components/goal-composer', () => ({
  GoalComposer: ({ initialGoal }: { initialGoal: string }) => initialGoal,
}));
vi.mock('@/server/runs/actions', () => ({
  createRun: vi.fn(() => {
    throw new Error('GET must not create tasks');
  }),
}));
it('renders a draft from GET without submitting it', async () => {
  const page = await NewRunPage({
    searchParams: Promise.resolve({ goal: 'Extract monthly prices' }),
  });
  expect(renderToStaticMarkup(page)).toContain('Extract monthly prices');
});
