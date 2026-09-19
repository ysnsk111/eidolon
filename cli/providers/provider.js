/**
 * Abstract Base LLM Provider
 */
export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }

  async generate(messages, options = {}) {
    throw new Error('generate() must be implemented');
  }

  async distill(systemPrompt, userPrompt, options = {}) {
    throw new Error('distill() must be implemented');
  }

  async extract(text, instructions, options = {}) {
    throw new Error('extract() must be implemented');
  }

  async judge(context, candidateA, candidateB, options = {}) {
    throw new Error('judge() must be implemented');
  }

  async critic(candidate, groundTruthContext, options = {}) {
    throw new Error('critic() must be implemented');
  }
}
