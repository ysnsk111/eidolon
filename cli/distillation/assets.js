/**
 * EIDOLON Layer 5: Emoji & Sticker Contextual Model
 * Implements Section 14 of the specification.
 */

// Full Unicode compound emoji regex supporting regional flags, skin tone modifiers,
// variation selectors (\uFE0E, \uFE0F), and zero-width joiner (\u200D) sequences
const COMPOUND_EMOJI_REGEX =
  /(?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

// Sticker text pattern in chat exports
const STICKER_PATTERN = /\[(?:sticker|表情包|动画表情|动画贴图)[^\]]*\]/gi;

// Non-conversational symbols that match Extended_Pictographic but are not emojis
const NON_EMOJI_SYMBOLS = new Set(['®', '©', '™', '〰', '〽', 'ℹ', 'Ⓜ', '㊗', '㊙', '🅿']);

export function extractAssetModels(texts, turns = []) {
  // Normalize arguments: support turns array passed as first argument or second argument
  let targetTexts = [];
  let turnList = [];

  if (Array.isArray(texts)) {
    if (texts.length > 0 && typeof texts[0] === 'object' && texts[0].target_message) {
      turnList = texts;
      targetTexts = turnList.map((t) => t.target_message || '');
    } else {
      targetTexts = texts;
      turnList = Array.isArray(turns) ? turns : [];
    }
  }

  const emojiStats = {};
  const stickerStats = {};
  const totalTexts = targetTexts.length;

  // Helper to safely extract emojis from a string
  function getEmojis(str) {
    if (!str || typeof str !== 'string') return [];
    const matches = str.match(COMPOUND_EMOJI_REGEX) || [];
    return matches.filter((e) => !NON_EMOJI_SYMBOLS.has(e) && !/^[\u0000-\u00FF]$/.test(e));
  }

  // Helper to extract stickers from a string
  function getStickers(str) {
    if (!str || typeof str !== 'string') return [];
    return str.match(STICKER_PATTERN) || [];
  }

  // 1. If turns are available, extract context tags from aligned dialogue turns (P0 Index Desync Fix)
  if (turnList.length > 0) {
    for (const turn of turnList) {
      const targetText = turn.target_message || '';
      const contextText = Array.isArray(turn.context)
        ? turn.context.map((c) => c.content || '').join(' ')
        : '';
      const contexts = detectContextTags(contextText, targetText);

      // Emojis from turn
      const foundEmojis = getEmojis(targetText);
      for (const emoji of foundEmojis) {
        if (!emojiStats[emoji]) {
          emojiStats[emoji] = { count: 0, contexts: new Set() };
        }
        contexts.forEach((ctx) => emojiStats[emoji].contexts.add(ctx));
      }

      // Stickers from turn
      const foundStickers = getStickers(targetText);
      for (const sticker of foundStickers) {
        if (!stickerStats[sticker]) {
          stickerStats[sticker] = { count: 0, contexts: new Set() };
        }
        contexts.forEach((ctx) => stickerStats[sticker].contexts.add(ctx));
      }
    }
  }

  // 2. Count raw frequency across all target texts
  for (const text of targetTexts) {
    const foundEmojis = getEmojis(text);
    for (const emoji of foundEmojis) {
      if (!emojiStats[emoji]) {
        emojiStats[emoji] = { count: 0, contexts: new Set() };
      }
      emojiStats[emoji].count++;

      // If turns were empty or emoji was not seen in training turns, infer context from text itself
      if (emojiStats[emoji].contexts.size === 0) {
        const fallbackContexts = detectContextTags('', text);
        fallbackContexts.forEach((ctx) => emojiStats[emoji].contexts.add(ctx));
      }
    }

    const foundStickers = getStickers(text);
    for (const sticker of foundStickers) {
      if (!stickerStats[sticker]) {
        stickerStats[sticker] = { count: 0, contexts: new Set() };
      }
      stickerStats[sticker].count++;

      if (stickerStats[sticker].contexts.size === 0) {
        const fallbackContexts = detectContextTags('', text);
        fallbackContexts.forEach((ctx) => stickerStats[sticker].contexts.add(ctx));
      }
    }
  }

  // Ensure every detected asset has at least one context tag
  for (const data of Object.values(emojiStats)) {
    if (data.contexts.size === 0) data.contexts.add('casual_chat');
  }
  for (const data of Object.values(stickerStats)) {
    if (data.contexts.size === 0) data.contexts.add('casual_chat');
  }

  // Build structured assets representation
  const emojis = Object.entries(emojiStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([asset, data]) => ({
      asset,
      raw_count: data.count,
      frequency: totalTexts > 0 ? round(data.count / totalTexts, 4) : 0,
      contexts: Array.from(data.contexts),
      confidence: calculateConfidence(data.count, totalTexts),
    }));

  const stickers = Object.entries(stickerStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([asset, data]) => ({
      asset,
      raw_count: data.count,
      frequency: totalTexts > 0 ? round(data.count / totalTexts, 4) : 0,
      contexts: Array.from(data.contexts),
      confidence: calculateConfidence(data.count, totalTexts),
    }));

  return {
    emojis,
    stickers,
    total_emojis_used: emojis.reduce((acc, e) => acc + e.raw_count, 0),
    total_stickers_used: stickers.reduce((acc, s) => acc + s.raw_count, 0),
    emoji_vocabulary_size: emojis.length,
  };
}

export function detectContextTags(contextText, targetText) {
  const combined = `${contextText} ${targetText}`.trim();
  const tags = [];

  if (/(?:哈哈|233|逗|笑死|笑出声|好玩|逗比|lol|haha|xd|😂|🤣)/i.test(combined)) tags.push('joking');
  if (/(?:爱|喜欢|抱抱|亲亲|比心|想你|暖心|好棒|🥰|😍|❤️)/i.test(combined)) tags.push('affection');
  if (/(?:好不好|求求|拜托|好嘛|可以嘛|帮帮|帮我|求你|🥺|QAQ|qwq)/i.test(combined)) tags.push('pleading_cute');
  if (/(?:困|睡了|晚安|累死|撑不住|好累|睡觉|休息|歇歇|😴|🥱)/i.test(combined)) tags.push('tired_sleep');
  if (/(?:笨蛋|才不|哼|明明|略略略|傲娇|😏)/i.test(combined)) tags.push('teasing_banter');
  if (/(?:太棒了|冲|恭喜|稳了|牛哇|厉害|干得漂亮|庆祝|🎉|👏|🍻)/i.test(combined)) tags.push('celebration');
  if (/(?:好呀|好的呀|好嘞|没问题|同意|赞成|行呀|走起|妥妥|OK|ok|👍)/i.test(combined)) tags.push('agreement');
  if (/(?:难过|伤心|哭了|呜呜|委屈|破防|心碎|惨|哭死|😭|😢)/i.test(combined)) tags.push('sadness');
  if (/(?:气死|烦|讨厌|无语|暴躁|抓狂|崩溃|服了|离谱|😡|🤬)/i.test(combined)) tags.push('frustration');
  if (/(?:想想|琢磨|好奇|思考|分析|为什么|为啥|🤔)/i.test(combined)) tags.push('thinking');
  if (/(?:早呀|早上好|哈喽|嗨|hi|hello|拜拜啦|回头见|改天聊|在吗|在嘛)/i.test(combined)) tags.push('greeting_closing');

  if (tags.length === 0) tags.push('casual_chat');
  return tags;
}

function calculateConfidence(count, total) {
  if (count <= 1) return 0.60;
  if (count <= 3) return 0.75;
  if (count <= 10) return 0.88;
  return 0.95;
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
