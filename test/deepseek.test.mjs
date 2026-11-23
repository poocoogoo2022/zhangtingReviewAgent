import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeekClient } from '../dist/llm/deepseek.js';

const messages = [{ role: 'user', content: '测试复盘' }];
const config = { apiKey: 'test-key', model: 'test-model' };

test('DeepSeek 请求固定使用官方 HTTPS 端点，不跟随重定向', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    const { model, stream } = JSON.parse(init.body);
    assert.equal(model, 'test-model');
    assert.equal(stream, false);
    return Response.json({ choices: [{ message: { content: '测试通过' } }] });
  });

  assert.equal(await new DeepSeekClient(config).chat(messages), '测试通过');
});
