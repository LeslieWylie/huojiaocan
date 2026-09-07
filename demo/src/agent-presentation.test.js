import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPresentation } from './agent-presentation.js';
test('missing telemetry never invents completed agent work', () => {
  assert.deepEqual(agentPresentation({ generationRounds: 3 }).steps, []);
});
test('only known server stages and statuses are displayed in workflow order', () => {
  const result = agentPresentation({ agentRun: { events: [
    { stage: 'draft', status: 'completed', message: 'internal-code' },
    { stage: 'grounding', status: 'needs_attention' },
    { stage: 'shell', status: 'completed' },
    { stage: 'evidence_review', status: 'invented' }
  ] } });
  assert.equal(result.attention, true);
  assert.deepEqual(result.steps.map(step => step.stage), ['grounding', 'draft']);
  assert.ok(!JSON.stringify(result).includes('internal-code'));
});
test('pending teacher confirmation is not automatic approval', () => {
  const result = agentPresentation({ agentRun: { events: [{ stage: 'teacher_confirmation', status: 'pending' }] } });
  assert.equal(result.steps[0].statusLabel, '待确认');
  assert.match(result.title, /请结合教材确认/);
});
