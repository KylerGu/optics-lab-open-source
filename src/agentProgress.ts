import type { AgentStep } from './spatialAgent';

export interface AgentProgressView {
  currentSummary: string;
  isReasoning: boolean;
  completed: AgentStep[];
}

export function isTransientProgressStep(step: Partial<AgentStep> | null | undefined): boolean {
  const name = typeof step?.name === 'string' ? step.name : '';
  const summary = typeof step?.summary === 'string' ? step.summary : '';
  return (
    name.startsWith('phase_') ||
    name === 'builder_start' ||
    summary.startsWith('正在') ||
    summary.startsWith('搭建助手：正在')
  );
}

/**
 * Append one streamed step into the live progress buffer.
 * Transient phase updates overwrite only the trailing transient indicator so
 * completed tool steps are never evicted during long reasoning pauses.
 */
export function appendProgressStep(
  steps: readonly AgentStep[],
  incoming: AgentStep,
  maxCompleted = 40,
): AgentStep[] {
  const completed = steps.filter(step => !isTransientProgressStep(step));
  if (isTransientProgressStep(incoming)) {
    return [...completed.slice(-maxCompleted), incoming];
  }
  return [...completed, incoming].slice(-maxCompleted);
}

export function completedProgressSteps(steps: readonly AgentStep[]): AgentStep[] {
  return steps.filter(
    step =>
      !!step &&
      typeof step.name === 'string' &&
      typeof step.summary === 'string' &&
      step.summary.trim().length > 0 &&
      !isTransientProgressStep(step),
  );
}

export function summarizeAgentProgress(
  steps: readonly AgentStep[],
  fallbackLabel = '正在探究问题…',
): AgentProgressView {
  const completed = completedProgressSteps(steps);
  const latest = steps.at(-1);
  if (!latest) {
    return { currentSummary: fallbackLabel, isReasoning: false, completed };
  }
  const currentSummary = isTransientProgressStep(latest)
    ? latest.summary
    : `已完成：${latest.summary}`;
  const isReasoning = latest.name === 'phase_thinking' || latest.name === 'phase_builder_thinking';
  return { currentSummary, isReasoning, completed };
}

export function formatElapsedDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatChineseDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (totalSeconds < 1) return '用时不足 1 秒';
  if (totalSeconds < 60) return `用时 ${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `用时 ${minutes} 分 ${seconds} 秒` : `用时 ${minutes} 分`;
}

function finalizeStepSummary(step: Partial<AgentStep>): string {
  const raw = typeof step.summary === 'string' ? step.summary : '';
  let summary = raw.trim().replace(/[…\.]+$/u, '');
  if (summary.startsWith('搭建助手：正在')) {
    summary = `搭建助手：${summary.slice('搭建助手：正在'.length)}`;
  } else if (summary.startsWith('正在')) {
    summary = summary.slice('正在'.length);
  }
  return summary || raw;
}

export function buildCompletedTimeline(
  liveSteps: readonly AgentStep[],
  trace: readonly AgentStep[],
  maxSteps = 40,
): AgentStep[] {
  const source = liveSteps.length > 0 ? liveSteps : trace;
  const timeline: AgentStep[] = [];
  for (const step of source) {
    if (!step || typeof step.name !== 'string' || (step.status !== 'ok' && step.status !== 'error')) continue;
    const rawSummary = typeof step.summary === 'string' ? step.summary : '';
    const normalizedSummary = isTransientProgressStep(step)
      ? finalizeStepSummary(step)
      : rawSummary.trim();
    if (!normalizedSummary) continue;
    const item: AgentStep = {
      name: step.name,
      status: step.status,
      summary: normalizedSummary,
    };
    const prev = timeline.at(-1);
    if (isTransientProgressStep(step) && prev && prev.name === item.name) {
      timeline[timeline.length - 1] = item;
    } else {
      timeline.push(item);
    }
  }
  return timeline.slice(-maxSteps);
}

export function readProgressSteps(value: unknown, maxSteps = 40): AgentStep[] {
  if (!Array.isArray(value)) return [];
  const steps: AgentStep[] = [];
  for (const step of value.slice(0, maxSteps)) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const rec = step as Record<string, unknown>;
    if (
      typeof rec.name !== 'string' ||
      rec.name.length > 80 ||
      (rec.status !== 'ok' && rec.status !== 'error') ||
      typeof rec.summary !== 'string' ||
      !rec.summary ||
      rec.summary.length > 300
    ) {
      continue;
    }
    steps.push({ name: rec.name, status: rec.status, summary: rec.summary });
  }
  return steps;
}

export function readDurationMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000
    ? Math.round(value)
    : undefined;
}

export interface AgentStreamOptions<TReply> {
  signal: AbortSignal;
  maxBytes: number;
  sizeError: string;
  formatError: string;
  incompleteError: string;
  duplicateError: string;
  fallbackError: string;
  throwOnAbort?: boolean;
  onStep?: (step: AgentStep) => void;
  onDelta?: (text: string) => void;
  onReset?: () => void;
  parseStep: (raw: unknown) => AgentStep;
  parseReply: (raw: unknown) => TReply;
}

export async function consumeAgentNdjsonStream<TReply>(
  body: ReadableStream<Uint8Array>,
  options: AgentStreamOptions<TReply>,
): Promise<TReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const stopReading = () => {
    void reader.cancel().catch(() => {});
  };
  options.signal.addEventListener('abort', stopReading, { once: true });
  if (options.signal.aborted) stopReading();
  let buffer = '';
  let bytes = 0;
  let reply: TReply | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (options.throwOnAbort) options.signal.throwIfAborted();
      if (value) {
        bytes += value.byteLength;
        if (bytes > options.maxBytes) throw new Error(options.sizeError);
      }
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          throw new Error(options.formatError);
        }
        const record = event as Record<string, unknown>;
        if (record.type === 'progress') {
          options.onStep?.(options.parseStep(record.step));
        } else if (record.type === 'delta') {
          if (typeof record.text !== 'string') throw new Error(options.formatError);
          if (record.text) options.onDelta?.(record.text);
        } else if (record.type === 'answer_reset') {
          options.onReset?.();
        } else if (record.type === 'reply') {
          if (reply !== null) throw new Error(options.duplicateError);
          reply = options.parseReply(record.reply);
        } else if (record.type === 'error') {
          throw new Error(typeof record.message === 'string' ? record.message : options.fallbackError);
        } else {
          throw new Error(options.formatError);
        }
      }
      if (done) break;
    }
    if (buffer.trim() || reply === null) throw new Error(options.incompleteError);
    return reply;
  } finally {
    options.signal.removeEventListener('abort', stopReading);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
