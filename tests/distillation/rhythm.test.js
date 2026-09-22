import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';

describe('Conversation Rhythm & Latency Model Tests', () => {
  test('should compute observed response latency without fabricating typing speed', async () => {
    const messages = [
      { sender: 'Bob', isTarget: false, content: '你好', epochMs: 1000 },
      { sender: 'Alice', isTarget: true, content: '你好呀~', epochMs: 4000 },
      { sender: 'Bob', isTarget: false, content: '在干嘛呢', epochMs: 10000 },
      { sender: 'Alice', isTarget: true, content: '在看书呢', epochMs: 13500 },
    ];

    const turns = [
      { context: [{ sender: 'Bob', content: '你好' }], target_message: '你好呀~' },
      { context: [{ sender: 'Bob', content: '在干嘛呢' }], target_message: '在看书呢' },
    ];

    const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');

    // Section 13 & 31 DoD: Never fabricate 180 CPM
    assert.strictEqual(result.conversation_rhythm.typing_speed_cpm, null);
    assert.strictEqual(result.conversation_rhythm.typing_model.enabled, false);
    assert.ok(result.conversation_rhythm.response_latency);
    assert.ok(result.conversation_rhythm.latency_model);
    assert.ok(result.conversation_rhythm.double_message_probability > 0);
  });

  test('should eliminate minute-level 60000ms quantization artifacts and calibrate to realistic IM bounds', async () => {
    // Simulate chat export with minute-level timestamps (seconds truncated to :00)
    // Every reply latency produces 60,000ms inter-minute differences
    const messages = [
      // Short messages (<= 20 chars)
      { sender: 'Bob', isTarget: false, content: '在吗', epochMs: 60000 },
      { sender: 'Alice', isTarget: true, content: '在呀', epochMs: 120000 },
      { sender: 'Bob', isTarget: false, content: '吃了吗', epochMs: 180000 },
      { sender: 'Alice', isTarget: true, content: '刚吃完呢', epochMs: 240000 },
      { sender: 'Bob', isTarget: false, content: '好呀', epochMs: 300000 },
      { sender: 'Alice', isTarget: true, content: '准备刷题', epochMs: 360000 },

      // Medium messages (21-60 chars)
      { sender: 'Bob', isTarget: false, content: '今天微积分那道题怎么解出来的啊？', epochMs: 420000 },
      { sender: 'Alice', isTarget: true, content: '哈哈笨蛋，那道题要先换元呀，你仔细看第三章那个公式嘛', epochMs: 480000 },
      { sender: 'Bob', isTarget: false, content: '还是有点没懂，有空讲讲吗？', epochMs: 540000 },
      { sender: 'Alice', isTarget: true, content: '等我把草稿纸拍给你看，按照那个步骤算一遍就很清晰了', epochMs: 600000 },
      { sender: 'Bob', isTarget: false, content: '太感谢学霸了，晚上请你喝奶茶！', epochMs: 660000 },
      { sender: 'Alice', isTarget: true, content: '好呀好呀！我想喝二食堂旁边的黑糖珍珠奶茶，半糖去冰~', epochMs: 720000 },

      // Long messages (> 60 chars)
      { sender: 'Bob', isTarget: false, content: '帮我看看这篇报告的结构可以吗？', epochMs: 780000 },
      { sender: 'Alice', isTarget: true, content: '我大概看了一下，整体逻辑挺顺畅的，不过第二部分实验数据的分析稍微有些简略，建议补充一下对照组在不同温度下的误差范围图表，结论部分也可以再强调一下核心创新点，这样评审看起来会更有说服力哦！', epochMs: 840000 },
      { sender: 'Bob', isTarget: false, content: '引言部分需要精简吗？', epochMs: 900000 },
      { sender: 'Alice', isTarget: true, content: '引言可以再凝练两句话，把背景介绍缩减一点，直接突出本次实验要解决的关键瓶颈问题，后面的研究现状总结得已经很全面了，不需要重复铺陈前面的基础概念。', epochMs: 960000 },
      { sender: 'Bob', isTarget: false, content: '明白啦，排版有讲究吗？', epochMs: 1020000 },
      { sender: 'Alice', isTarget: true, content: '字体字号统一用规范模板就好，三级标题的行间距稍微留大一点点，公式编号记得靠右对齐，图表下方的说明文字用五号宋体，看起来会更加整洁专业。', epochMs: 1080000 },
    ];

    const turns = messages
      .filter((m) => m.isTarget)
      .map((m, idx) => ({
        context: [{ sender: 'Bob', content: '测试消息' }],
        target_message: m.content,
      }));

    const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');
    const rhythm = result.conversation_rhythm;

    // F10 DoD: Response latency median must be 2,000 - 4,000 ms, NEVER 60,000ms
    assert.notEqual(rhythm.response_latency.median_ms, 60000, 'Must NOT be 60000ms quantization spike');
    assert.ok(
      rhythm.response_latency.median_ms >= 2000 && rhythm.response_latency.median_ms <= 4000,
      `Expected response latency median 2000-4000ms, got ${rhythm.response_latency.median_ms}ms`
    );

    // F10 DoD: Latency model short bucket median must be 1,500 - 3,000 ms
    assert.notEqual(rhythm.latency_model.short.median_ms, 60000);
    assert.ok(
      rhythm.latency_model.short.median_ms >= 1500 && rhythm.latency_model.short.median_ms <= 3000,
      `Expected short median 1500-3000ms, got ${rhythm.latency_model.short.median_ms}ms`
    );

    // F10 DoD: Latency model medium bucket median must be 3,000 - 5,500 ms
    assert.notEqual(rhythm.latency_model.medium.median_ms, 60000);
    assert.ok(
      rhythm.latency_model.medium.median_ms >= 3000 && rhythm.latency_model.medium.median_ms <= 5500,
      `Expected medium median 3000-5500ms, got ${rhythm.latency_model.medium.median_ms}ms`
    );

    // F10 DoD: Latency model long bucket median must be 5,000 - 8,000 ms
    assert.notEqual(rhythm.latency_model.long.median_ms, 60000);
    assert.ok(
      rhythm.latency_model.long.median_ms >= 5000 && rhythm.latency_model.long.median_ms <= 8000,
      `Expected long median 5000-8000ms, got ${rhythm.latency_model.long.median_ms}ms`
    );
  });

  test('should scale sub-minute delays across message length buckets within calibrated bounds', async () => {
    // Simulate authentic sub-minute timestamps
    const messages = [
      // Short turns: ~2,200ms
      { sender: 'Bob', isTarget: false, content: '在吗', epochMs: 1000 },
      { sender: 'Alice', isTarget: true, content: '在呀', epochMs: 3200 },
      { sender: 'Bob', isTarget: false, content: '去吃饭吗', epochMs: 5000 },
      { sender: 'Alice', isTarget: true, content: '去！', epochMs: 7100 },
      { sender: 'Bob', isTarget: false, content: '楼下见', epochMs: 9000 },
      { sender: 'Alice', isTarget: true, content: '好嘞', epochMs: 11300 },

      // Medium turns: ~3,800ms (> 20 and <= 60 chars)
      { sender: 'Bob', isTarget: false, content: '你想吃什么好吃的呢', epochMs: 20000 },
      { sender: 'Alice', isTarget: true, content: '我想吃二食堂那个新出的酸汤牛肉粉，听说味道特别浓郁而且牛肉给得很足', epochMs: 23800 },
      { sender: 'Bob', isTarget: false, content: '听起来不错，排队多吗', epochMs: 30000 },
      { sender: 'Alice', isTarget: true, content: '现在去排队应该正好合适，大概等个五六分钟就能拿到餐了，我们在老位置坐', epochMs: 33900 },
      { sender: 'Bob', isTarget: false, content: '行，我现在从宿舍出发', epochMs: 40000 },
      { sender: 'Alice', isTarget: true, content: '我也把桌上的复习资料整理好了，这就带上伞下楼，我们在食堂门口碰头吧~', epochMs: 43700 },

      // Long turns: ~6,200ms (> 60 chars)
      { sender: 'Bob', isTarget: false, content: '帮我看看这道物理大题的思路对不对', epochMs: 60000 },
      { sender: 'Alice', isTarget: true, content: '第一问的受力分析完全正确，第二问电磁感应部分要注意洛伦兹力做的功等于动能变化量加上焦耳热，把两式联立消去速度即可得到最终位移，注意单位要换算', epochMs: 66200 },
      { sender: 'Bob', isTarget: false, content: '那积分上限应该是多少呀', epochMs: 80000 },
      { sender: 'Alice', isTarget: true, content: '积分上限要取导体棒完全脱离磁场区域的瞬间，此时速度达到收尾值，加速度刚好为零，把这个临界条件代入守恒方程就能解出时间常数了，推导过程注意正负号', epochMs: 86300 },
      { sender: 'Bob', isTarget: false, content: '第三问的能量损耗怎么求', epochMs: 100000 },
      { sender: 'Alice', isTarget: true, content: '总机械能的减少量减去安培力做的负功就是转化为内能的损耗，不要漏掉初始状态给系统的微小初速度所具有的初动能项哦，建议再验算一遍数量级是否合理', epochMs: 106100 },
    ];

    const turns = messages.filter((m) => m.isTarget).map((m) => ({
      context: [{ sender: 'Bob', content: '问题' }],
      target_message: m.content,
    }));

    const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');
    const rhythm = result.conversation_rhythm;

    assert.ok(rhythm.latency_model.short.median_ms >= 1500 && rhythm.latency_model.short.median_ms <= 3000);
    assert.ok(rhythm.latency_model.medium.median_ms >= 3000 && rhythm.latency_model.medium.median_ms <= 5500);
    assert.ok(rhythm.latency_model.long.median_ms >= 5000 && rhythm.latency_model.long.median_ms <= 8000);

    // Monotonic progression with message length
    assert.ok(
      rhythm.latency_model.short.median_ms <= rhythm.latency_model.medium.median_ms,
      'Short latency must be <= medium latency'
    );
    assert.ok(
      rhythm.latency_model.medium.median_ms <= rhythm.latency_model.long.median_ms,
      'Medium latency must be <= long latency'
    );
  });
});
