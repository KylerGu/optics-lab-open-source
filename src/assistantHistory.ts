import { assistantErrorMessage, validateAgentReply, type AgentReply } from './agent';
import { parseExperiment } from './model';
import { experimentKey } from './simulation';

export interface ConversationTurn {
  id: string; prompt: string; reply: AgentReply | null; error: string | null; application: string; applied?: boolean;
}
export interface AssistantConversation { draft: string; turns: ConversationTurn[] }
const sessions = new Map<string, AssistantConversation>();
const prefix = 'optics-ai-conversation-v1-';
const maximumTurns = 40;
const maximumStorageLength = 2_000_000;
const emptyConversation = (): AssistantConversation => ({ draft: '', turns: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseConversation(value: unknown): AssistantConversation {
  if (!record(value) || value.version !== 1 || typeof value.draft !== 'string' || value.draft.length > 2000 || !Array.isArray(value.turns)) return emptyConversation();
  const turns: ConversationTurn[] = [];
  for (const raw of value.turns.slice(-maximumTurns)) {
    if (!record(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100 || typeof raw.prompt !== 'string' || raw.prompt.length > 2000 || typeof raw.application !== 'string' || raw.application.length > 1000 || !(raw.error === null || typeof raw.error === 'string')) continue;
    try {
      const reply = raw.reply === null ? null : validateAgentReply(raw.reply, raw.id, experimentKey(parseExperiment((raw.reply as AgentReply).inputSnapshot)));
      turns.push({ id: raw.id, prompt: raw.prompt, reply, application: raw.application,
        ...(typeof raw.applied === 'boolean' ? { applied: raw.applied } : {}),
        error: raw.error ? assistantErrorMessage(new Error(raw.error as string)) : reply ? null : '上次请求未完成，你可以重新发送。' });
    } catch { /* Skip a damaged response while preserving other messages. */ }
  }
  return { draft: value.draft, turns };
}

export function loadConversation(scope: string): AssistantConversation {
  const cached = sessions.get(scope);
  if (cached) return parseConversation({ version: 1, ...cached });
  try {
    const raw = window.localStorage.getItem(prefix + scope);
    return raw && raw.length <= maximumStorageLength ? parseConversation(JSON.parse(raw)) : emptyConversation();
  } catch { return emptyConversation(); }
}

export function saveConversation(scope: string, conversation: AssistantConversation) {
  const bounded = { draft: conversation.draft, turns: conversation.turns.slice(-maximumTurns) };
  sessions.set(scope, bounded);
  try {
    let raw = JSON.stringify({ version: 1, ...bounded });
    if (raw.length > maximumStorageLength) {
      // Large design arrays remain in this session; persist the complete dialogue first.
      raw = JSON.stringify({ version: 1, draft: bounded.draft, turns: bounded.turns.map(turn => ({ ...turn,
        reply: turn.reply && { ...turn.reply, trace: [], scans: [], designs: [], studies: [] },
      })) });
    }
    window.localStorage.setItem(prefix + scope, raw);
  } catch { /* The in-memory copy still survives closing and reopening the panel. */ }
}
