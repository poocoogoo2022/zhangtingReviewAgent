/**
 * DeepSeek 客户端（OpenAI 兼容协议，原生 fetch，零依赖）
 * 文档：https://api-docs.deepseek.com/zh-cn/
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface ChatCompletionResponse {
  choices: { message: { content: string }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ChatCompletionChunk {
  choices: { delta: { content?: string }; finish_reason: string | null }[];
}

export function loadConfigFromEnv(): DeepSeekConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      '缺少 DEEPSEEK_API_KEY。请在项目根目录的 .env 中设置该变量（https://platform.deepseek.com/api_keys）',
    );
  }
  return {
    apiKey,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  };
}

async function* parseSSE(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error('响应无 body');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      yield payload;
    }
  }
}

export class DeepSeekClient {
  constructor(private config: DeepSeekConfig) {}

  /** 非流式对话，返回完整文本 */
  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await this.request(messages, false);
    const json = (await res.json()) as ChatCompletionResponse;
    const content = json.choices[0]?.message.content;
    if (!content) throw new Error('DeepSeek 返回空内容');
    return content;
  }

  /** 流式对话，逐段回调（用于 CLI 实时输出） */
  async chatStream(messages: ChatMessage[], onDelta: (text: string) => void): Promise<string> {
    const res = await this.request(messages, true);
    let full = '';
    for await (const payload of parseSSE(res)) {
      const chunk = JSON.parse(payload) as ChatCompletionChunk;
      const delta = chunk.choices[0]?.delta.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
    return full;
  }

  private async request(messages: ChatMessage[], stream: boolean): Promise<Response> {
    const { apiKey, model, temperature = 0.3, maxTokens = 4096 } = this.config;
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res;
  }
}
