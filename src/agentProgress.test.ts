import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendProgressStep,
  buildCompletedTimeline,
  completedProgressSteps,
  consumeAgentNdjsonStream,
  formatChineseDuration,
  formatElapsedDuration,
  isTransientProgressStep,
  readDurationMs,
  readProgressSteps,
  summarizeAgentProgress,
} from './agentProgress';
import type { AgentStep } from './spatialAgent';
import { validateSceneReply } from './sceneAssistantModel';
import { readScene } from './sceneRuntime';

test('transient phase steps update live status in place without evicting completed steps', () => {
  let steps: AgentStep[] = [];
  steps = appendProgressStep(steps, { name: 'phase_research', status: 'ok', summary: '正在分析问题并规划步骤…' });
  steps = appendProgressStep(steps, { name: 'phase_thinking', status: 'ok', summary: '正在深度推理…' });
  steps = appendProgressStep(steps, { name: 'phase_thinking', status: 'ok', summary: '正在深度推理（已推演约 420 字）…' });
  assert.equal(steps.length, 1);
  assert.equal(isTransientProgressStep(steps[0]), true);

  steps = appendProgressStep(steps, { name: 'phase_simulate_apparatus', status: 'ok', summary: '正在运行三维光路与物理计算…' });
  assert.equal(steps.length, 1);

  steps = appendProgressStep(steps, { name: 'simulate_apparatus', status: 'ok', summary: '按当前参数完成三维计算' });
  assert.deepEqual(steps.map(s => s.name), ['simulate_apparatus']);

  steps = appendProgressStep(steps, { name: 'phase_builder_trace_light', status: 'ok', summary: '搭建助手：正在运行三维光线追迹与核对…' });
  steps = appendProgressStep(steps, { name: 'builder_trace_light', status: 'ok', summary: '搭建助手：完成三维追迹' });
  assert.deepEqual(steps.map(s => s.name), ['simulate_apparatus', 'builder_trace_light']);
  assert.equal(completedProgressSteps(steps).length, 2);

  const view = summarizeAgentProgress(steps, '正在探究问题…');
  assert.equal(view.completed.length, 2);
  assert.equal(view.currentSummary, '已完成：搭建助手：完成三维追迹');
  assert.equal(view.isReasoning, false);
});

test('reasoning summary flags thinking phase and elapsed timer formats cleanly', () => {
  const steps: AgentStep[] = [
    { name: 'read_research', status: 'ok', summary: '读取实验装置' },
    { name: 'phase_thinking', status: 'ok', summary: '正在深度推理（已推演约 640 字）…' },
  ];
  const view = summarizeAgentProgress(steps);
  assert.equal(view.isReasoning, true);
  assert.equal(view.currentSummary, '正在深度推理（已推演约 640 字）…');
  assert.equal(view.completed.length, 1);

  assert.equal(formatElapsedDuration(0), '0s');
  assert.equal(formatElapsedDuration(9400), '9s');
  assert.equal(formatElapsedDuration(60000), '1m');
  assert.equal(formatElapsedDuration(75000), '1m 15s');
  assert.equal(formatChineseDuration(200), '用时不足 1 秒');
  assert.equal(formatChineseDuration(12400), '用时 12 秒');
  assert.equal(formatChineseDuration(61000), '用时 1 分 1 秒');
  assert.equal(formatChineseDuration(120000), '用时 2 分');
});

test('buildCompletedTimeline keeps safe thinking milestones for 0-tool Q&A turns and deduplicates phase updates', () => {
  const live = [
    { name: 'phase_preparing', status: 'ok' as const, summary: '正在整理当前研究问题与实验上下文…' },
    { name: 'phase_thinking', status: 'ok' as const, summary: '正在深度推理（已推演约 180 字）…' },
    { name: 'phase_thinking', status: 'ok' as const, summary: '正在深度推理（已推演约 540 字）…' },
    { name: 'phase_writing', status: 'ok' as const, summary: '正在组织回答…' },
  ];
  const timeline = buildCompletedTimeline(live, []);
  assert.deepEqual(timeline.map(s => [s.name, s.summary]), [
    ['phase_preparing', '整理当前研究问题与实验上下文'],
    ['phase_thinking', '深度推理（已推演约 540 字）'],
    ['phase_writing', '组织回答'],
  ]);

  const fallback = buildCompletedTimeline([], [
    { name: 'simulate_experiment', status: 'ok', summary: '按当前参数完成三维计算' },
  ]);
  assert.deepEqual(fallback.map(s => s.summary), ['按当前参数完成三维计算']);
});

test('consumeAgentNdjsonStream streams progress, deltas, resets, and split UTF-8 replies', async () => {
  const payload =
    '\n' +
    JSON.stringify({ type: 'progress', step: { name: 'phase_scene', status: 'ok', summary: '正在分析当前场景与问题…' } }) + '\n' +
    JSON.stringify({ type: 'delta', text: '草稿前缀' }) + '\n' +
    JSON.stringify({ type: 'answer_reset' }) + '\n' +
    JSON.stringify({ type: 'delta', text: '正式' }) + '\n' +
    JSON.stringify({ type: 'delta', text: '回答。' }) + '\n' +
    JSON.stringify({ type: 'reply', reply: { ok: true, answer: '正式回答。' } }) + '\n';
  const encoded = new TextEncoder().encode(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < encoded.length; i += 7) {
        controller.enqueue(encoded.slice(i, i + 7));
      }
      controller.close();
    },
  });

  const phases: string[] = [];
  let text = '';
  const reply = await consumeAgentNdjsonStream(stream, {
    signal: new AbortController().signal,
    maxBytes: 1_000_000,
    sizeError: 'too big',
    formatError: 'bad format',
    incompleteError: 'incomplete',
    duplicateError: 'duplicate',
    fallbackError: 'failed',
    onStep: step => phases.push(step.summary),
    onDelta: chunk => { text += chunk; },
    onReset: () => { text = ''; },
    parseStep: raw => raw as AgentStep,
    parseReply: raw => raw as { ok: boolean; answer: string },
  });

  assert.deepEqual(phases, ['正在分析当前场景与问题…']);
  assert.equal(text, '正式回答。');
  assert.deepEqual(reply, { ok: true, answer: '正式回答。' });

  assert.equal(readProgressSteps([{ name: 'a', status: 'ok', summary: '完成' }, { bad: true }]).length, 1);
  assert.equal(readDurationMs(1234.6), 1235);
  assert.equal(readDurationMs(-1), undefined);
});

test('legacy trace steps missing summary do not crash progress helpers or survive validateSceneReply', () => {
  const partialStep = { name: 'calculate', status: 'ok' } as unknown as AgentStep;
  assert.equal(isTransientProgressStep(partialStep), false);
  assert.deepEqual(completedProgressSteps([partialStep]), []);

  const snap = readScene('reflection-refraction-0');
  const validated = validateSceneReply(
    {
      requestId: 'legacy-1',
      inputSnapshot: snap,
      state: snap,
      changed: false,
      answer: '临界角由折射率比值决定。',
      evidence: null,
      scans: [],
      trace: [{ name: 'calculate', status: 'ok' }],
    },
    'legacy-1',
    snap,
  );
  assert.equal(validated.trace, undefined);
});
