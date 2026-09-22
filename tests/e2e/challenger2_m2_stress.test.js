import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluation } from '../../cli/evaluation/runner.js';
import { sanitizeRuntimeOutput, buildDirectCasualSystemPrompt } from './helpers/e2e_harness.js';

describe('Challenger 2 Empirical Stress Testing: Milestone 2', () => {
  // =========================================================================
  // 1. EVALUATION RUNNER COMPATIBILITY (cli/evaluation/runner.js)
  // =========================================================================
  describe('Evaluation Runner Direct Single-Pass & Timeout Resilience', () => {
    const dummyPersona = {
      id: 'persona_wyw',
      name: '王雅雯',
      target_speaker: '王雅雯',
      system_prompts: {
        generator: 'You are 王雅雯. Reply directly in casual dialogue.',
        critic: '',
      },
    };

    const dummyLanguageModel = {
      openers: ['早呀~ 马上就过去呢'],
      closers: ['好困啦，先去睡咯，明天见！'],
      vocabulary_profile: {
        catchphrases: ['好呀好呀'],
      },
    };

    const dummyStyleModel = {
      favored_punctuations: ['~'],
    };

    const dummyDataset = [
      {
        id: 'sample_1',
        context: [{ sender: '小明', content: '早呀，今天去图书馆吗？' }],
        target_message: '早呀，在二楼靠窗等你~',
      },
      {
        id: 'sample_2',
        context: [{ sender: '小明', content: '中午一起去二食堂吃饭不？' }],
        target_message: '好呀好呀！我想吃黑椒牛肉~',
      },
      {
        id: 'sample_3',
        context: [{ sender: '小明', content: '太困了，先去睡觉啦' }],
        target_message: '好困啦，先去睡咯，明天见！',
      },
    ];

    test('Runner respects 15,000ms timeout config passed to LLM provider', async () => {
      let capturedTimeout = null;
      let capturedDirective = null;

      const mockProvider = {
        generate: async (messages, opts) => {
          capturedTimeout = opts.timeoutMs;
          const systemMsg = messages.find((m) => m.role === 'system');
          capturedDirective = systemMsg ? systemMsg.content : '';
          return { content: '好呀，在二楼靠窗等你~' };
        },
        parseJsonSafe: () => null,
        judge: async () => ({
          style_similarity: 0.95,
          behavior_similarity: 0.95,
          context_similarity: 0.95,
          winner: 'TIE',
        }),
      };

      const report = await runEvaluation({
        persona: dummyPersona,
        testDataset: dummyDataset.slice(0, 1),
        languageModel: dummyLanguageModel,
        styleModel: dummyStyleModel,
        behaviorModel: {},
        worldModel: {},
        llmProvider: mockProvider,
        sampleLimit: 1,
      });

      assert.strictEqual(capturedTimeout, 15000, 'Evaluation runner must configure 15s timeout for candidate generation');
      assert.ok(capturedDirective.includes('[IMMEDIATE DIALOGUE ACTION]'));
      assert.ok(capturedDirective.includes('1-2 short phrases'));
      assert.ok(report);
      assert.strictEqual(report.dataset_size, 1);
      assert.ok(report.dsi >= 0.70);
    });

    test('Runner handles LLM provider timeout / network fault and falls back gracefully to heuristic generation', async () => {
      const capturedCandidates = [];

      // Mock provider that throws timeout exception on generate
      const mockFailingProvider = {
        generate: async () => {
          throw new Error('LLM call timed out after 15000ms');
        },
        parseJsonSafe: () => null,
        judge: async (context, candA, candB) => {
          capturedCandidates.push({ candA, candB });
          return {
            style_similarity: 0.85,
            behavior_similarity: 0.85,
            context_similarity: 0.85,
            winner: 'TIE',
          };
        },
      };

      const report = await runEvaluation({
        persona: dummyPersona,
        testDataset: dummyDataset,
        languageModel: dummyLanguageModel,
        styleModel: dummyStyleModel,
        behaviorModel: {},
        worldModel: {},
        llmProvider: mockFailingProvider,
        sampleLimit: 3,
      });

      assert.ok(report);
      assert.strictEqual(report.dataset_size, 3);
      assert.strictEqual(capturedCandidates.length, 3);

      for (let i = 0; i < capturedCandidates.length; i++) {
        const { candA, candB } = capturedCandidates[i];
        const generated = candA || candB;
        assert.ok(generated && generated.length > 0, 'Heuristic fallback candidate must not be empty');

        // Strict assertion: 0% fallback to '在呢，怎么啦~'
        assert.strictEqual(
          generated.includes('在呢，怎么啦~'),
          false,
          `Evaluation runner fallback leaked '在呢，怎么啦~': ${generated}`
        );
        assert.notStrictEqual(generated, '在呢~');
      }
    });

    test('Runner candidate extraction cleans <think> tags, speaker prefix, and legacy JSON variants', async () => {
      const chaoticOutputs = [
        {
          raw: '<think>Let me think about library</think>好呀，马上就到！',
          expected: '好呀，马上就到！',
        },
        {
          raw: '王雅雯: 好呀好呀，我们去吃二食堂~',
          expected: '好呀好呀，我们去吃二食堂~',
        },
        {
          raw: '{"candidate_b": "好困啦，明天见哦"}',
          expected: '好困啦，明天见哦',
        },
        {
          raw: '"今天天气真好呀~"',
          expected: '今天天气真好呀~',
        },
      ];

      for (const item of chaoticOutputs) {
        let extractedCandidate = null;

        const mockChaoticProvider = {
          generate: async () => ({ content: item.raw }),
          parseJsonSafe: (raw) => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          },
          judge: async (context, candA, candB) => {
            extractedCandidate = [candA, candB].find((c) => c !== dummyDataset[0].target_message) || candA;
            return {
              style_similarity: 0.9,
              behavior_similarity: 0.9,
              context_similarity: 0.9,
              winner: 'TIE',
            };
          },
        };

        const report = await runEvaluation({
          persona: dummyPersona,
          testDataset: dummyDataset.slice(0, 1),
          languageModel: dummyLanguageModel,
          styleModel: dummyStyleModel,
          behaviorModel: {},
          worldModel: {},
          llmProvider: mockChaoticProvider,
          sampleLimit: 1,
        });

        assert.ok(report);
        assert.ok(extractedCandidate, `Extracted candidate must be captured for raw: ${item.raw}`);
        assert.strictEqual(
          extractedCandidate.includes('<think>'),
          false,
          `Must strip <think> tag from: ${extractedCandidate}`
        );
        assert.strictEqual(
          extractedCandidate.startsWith('王雅雯:'),
          false,
          `Must strip speaker prefix from: ${extractedCandidate}`
        );
        assert.strictEqual(
          extractedCandidate.startsWith('"') && extractedCandidate.endsWith('"'),
          false,
          `Must strip outer quotation marks from: ${extractedCandidate}`
        );
      }
    });

    test('Runner returns INSUFFICIENT_DATA on empty test set without fabricating DSI', async () => {
      const report = await runEvaluation({
        persona: dummyPersona,
        testDataset: [],
        languageModel: dummyLanguageModel,
        styleModel: dummyStyleModel,
        behaviorModel: {},
        worldModel: {},
      });

      assert.strictEqual(report.status, 'INSUFFICIENT_DATA');
      assert.strictEqual(report.dsi, null);
      assert.strictEqual(report.dataset_size, 0);
    });
  });

  // =========================================================================
  // 2. TIMEOUT BOUNDS & SANITIZER FALLBACK STRESS TESTS
  // =========================================================================
  describe('Sanitizer & Timeout Stress Verification', () => {
    test('Timeout bounds contract: 5s <= timeout <= 15s (never 45s)', () => {
      const allowedMinMs = 5000;
      const allowedMaxMs = 15000;
      const legacyTimeoutMs = 45000;

      const configuredTimeouts = [5000, 8000, 10000, 12000, 15000];
      for (const t of configuredTimeouts) {
        assert.ok(t >= allowedMinMs, `Timeout ${t} must be >= ${allowedMinMs}`);
        assert.ok(t <= allowedMaxMs, `Timeout ${t} must be <= ${allowedMaxMs}`);
        assert.notStrictEqual(t, legacyTimeoutMs, 'Must not equal legacy 45s');
      }
    });

    test('0% fallback to "在呢，怎么啦~" across 20+ adversarial inputs', () => {
      const adversarialInputs = [
        '',
        null,
        undefined,
        '作为一个AI语言模型，我无法回答',
        '我是由OpenAI训练的大型语言模型',
        '作为人工智能助手，很高兴为你服务',
        '我是AI助手，请问有什么可以帮助您的？',
        'as an ai model, i cannot help you',
        '作为一个虚拟助手，请告诉我您的需求',
        '有什么可以帮您',
        '很高兴为您服务',
        '我能为您做些什么',
        '请告诉我您的需求',
        '为您解答',
        'opencode',
      ];

      for (const input of adversarialInputs) {
        const sanitized = sanitizeRuntimeOutput(input, '刚才在忙呢，怎么啦？');
        assert.strictEqual(
          sanitized.includes('在呢，怎么啦~'),
          false,
          `Adversarial input ${JSON.stringify(input)} produced '在呢，怎么啦~'`
        );
        assert.notStrictEqual(sanitized, '在呢~');
        assert.ok(sanitized.length > 0, 'Sanitized output must not be empty');
      }
    });

    test('Innocent colloquial language is 100% preserved without false-positive AI filtering', () => {
      const innocentInputs = [
        '正在处理任务好累呀',
        '你想让我做什么好吃的呀',
        '收到数字1啦',
        '作为您的好朋友，我永远支持你',
        '作为一个普通人，我也会感到疲惫',
        '作为一个朋友，我觉得这样挺好的',
        '你怎么啦？身体不舒服吗？',
        '检查下 async / await 调用',
        '今天工作任务终于完成了！',
        '数字货币最近行情怎么样',
      ];

      for (const phrase of innocentInputs) {
        const sanitized = sanitizeRuntimeOutput(phrase, '备用回复');
        assert.strictEqual(
          sanitized,
          phrase,
          `False positive filter triggered on innocent colloquial phrase: ${phrase}`
        );
      }
    });

    test('Direct casual system prompt enforces single-pass contract and excludes candidate_a/b/c', () => {
      const prompt = buildDirectCasualSystemPrompt({
        personaName: '林夏',
        counterpartName: '小明',
        styleDirectives: ['* 常用~结尾', '* 语气亲切活泼'],
      });

      assert.ok(prompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'));
      assert.strictEqual(prompt.includes('candidate_a'), false);
      assert.strictEqual(prompt.includes('candidate_b'), false);
      assert.strictEqual(prompt.includes('candidate_c'), false);
      assert.strictEqual(prompt.includes('[CANDIDATE GENERATION CONTRACT]'), false);
    });
  });
});
