import type { LLMCompletion, LLMToolCall, PromptContext } from '../index';

describe('LLM shared contracts (dependency boundary)', () => {
  it('PromptContext and LLMCompletion are canonical in shared', () => {
    const prompt: PromptContext = {
      systemPromptVersion: '1',
      userMessage: 'Research this company',
      toolsAvailable: ['SearchWeb'],
    };

    const toolCall: LLMToolCall = {
      toolId: 'SearchWeb',
      toolVersion: '1.0.0',
      input: { query: 'Acme Corp' },
    };

    const completion: LLMCompletion = {
      content: 'Acme Corp is a manufacturing company.',
      toolCalls: [toolCall],
      model: 'gpt-4o',
      provider: 'azure-openai',
      tokensInput: 10,
      tokensOutput: 20,
      costUsd: 0.001,
    };

    expect(prompt.userMessage).toBe('Research this company');
    expect(completion.toolCalls).toHaveLength(1);
    expect(completion.toolCalls?.[0].toolId).toBe('SearchWeb');
  });
});
