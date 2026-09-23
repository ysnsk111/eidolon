/**
 * EIDOLON Layer 5: Emoji & Sticker Contextual Model
 * Implements Section 14 & Section 23 of the specification: P(emoji | context, emotion, style).
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
  let messagesWithEmojiCount = 0;

  // Helper to safely extract emojis from a string
  function getEmojis(str) {
    if (!str || typeof str !== 'string') return [];
    COMPOUND_EMOJI_REGEX.lastIndex = 0;
    const matches = str.match(COMPOUND_EMOJI_REGEX) || [];
    return matches.filter((e) => {
      const bare = e.replace(/[\uFE0E\uFE0F]/g, '');
      return !NON_EMOJI_SYMBOLS.has(e) && !NON_EMOJI_SYMBOLS.has(bare) && !/^[\u0000-\u00FF]$/.test(e);
    });
  }

  // Helper to extract stickers from a string
  function getStickers(str) {
    if (!str || typeof str !== 'string') return [];
    return str.match(STICKER_PATTERN) || [];
  }

  // 1. Process dialogue turns for context tags and positional style (Section 14 & Section 23)
  if (turnList.length > 0) {
    for (const turn of turnList) {
      const targetText = turn.target_message || '';
      const contextText = Array.isArray(turn.context)
        ? turn.context.map((c) => c.content || '').join(' ')
        : '';
      const contexts = detectContextTags(contextText, targetText);

      // Analyze emoji occurrences in this turn
      const foundEmojis = getEmojis(targetText);
      for (const emoji of foundEmojis) {
        if (!emojiStats[emoji]) {
          emojiStats[emoji] = {
            count: 0,
            contexts: new Set(),
            contextCounts: {},
            positions: { suffix: 0, prefix: 0, standalone: 0, inline: 0 },
          };
        }
        for (const ctx of contexts) {
          emojiStats[emoji].contexts.add(ctx);
          emojiStats[emoji].contextCounts[ctx] = (emojiStats[emoji].contextCounts[ctx] || 0) + 1;
        }

        // Positional modeling per Section 23 (文本+Emoji vs Emoji+文本 vs standalone)
        const trimmed = targetText.trim();
        if (trimmed === emoji) {
          emojiStats[emoji].positions.standalone++;
        } else if (trimmed.endsWith(emoji)) {
          emojiStats[emoji].positions.suffix++;
        } else if (trimmed.startsWith(emoji)) {
          emojiStats[emoji].positions.prefix++;
        } else {
          emojiStats[emoji].positions.inline++;
        }
      }

      // Stickers from turn
      const foundStickers = getStickers(targetText);
      for (const sticker of foundStickers) {
        if (!stickerStats[sticker]) {
          stickerStats[sticker] = { count: 0, contexts: new Set(), contextCounts: {} };
        }
        for (const ctx of contexts) {
          stickerStats[sticker].contexts.add(ctx);
          stickerStats[sticker].contextCounts[ctx] = (stickerStats[sticker].contextCounts[ctx] || 0) + 1;
        }
      }
    }
  }

  // 2. Count raw frequency across all target texts (Real frequency from target speaker's actual messages)
  for (const text of targetTexts) {
    const foundEmojis = getEmojis(text);
    if (foundEmojis.length > 0) {
      messagesWithEmojiCount++;
    }

    for (const emoji of foundEmojis) {
      if (!emojiStats[emoji]) {
        emojiStats[emoji] = {
          count: 0,
          contexts: new Set(),
          contextCounts: {},
          positions: { suffix: 0, prefix: 0, standalone: 0, inline: 0 },
        };
      }
      emojiStats[emoji].count++;

      // If turns were empty or emoji was not seen in training turns, infer context from text itself
      if (emojiStats[emoji].contexts.size === 0) {
        const fallbackContexts = detectContextTags('', text);
        for (const ctx of fallbackContexts) {
          emojiStats[emoji].contexts.add(ctx);
          emojiStats[emoji].contextCounts[ctx] = (emojiStats[emoji].contextCounts[ctx] || 0) + 1;
        }

        const trimmed = text.trim();
        if (trimmed === emoji) {
          emojiStats[emoji].positions.standalone++;
        } else if (trimmed.endsWith(emoji)) {
          emojiStats[emoji].positions.suffix++;
        } else if (trimmed.startsWith(emoji)) {
          emojiStats[emoji].positions.prefix++;
        } else {
          emojiStats[emoji].positions.inline++;
        }
      }
    }

    const foundStickers = getStickers(text);
    for (const sticker of foundStickers) {
      if (!stickerStats[sticker]) {
        stickerStats[sticker] = { count: 0, contexts: new Set(), contextCounts: {} };
      }
      stickerStats[sticker].count++;

      if (stickerStats[sticker].contexts.size === 0) {
        const fallbackContexts = detectContextTags('', text);
        for (const ctx of fallbackContexts) {
          stickerStats[sticker].contexts.add(ctx);
          stickerStats[sticker].contextCounts[ctx] = (stickerStats[sticker].contextCounts[ctx] || 0) + 1;
        }
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

  // Build structured assets representation with P(emoji | context, emotion, style)
  const emojis = Object.entries(emojiStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([asset, data]) => {
      const totalCtx = Object.values(data.contextCounts).reduce((a, b) => a + b, 0) || 1;
      const contextDistribution = {};
      for (const [ctx, cnt] of Object.entries(data.contextCounts)) {
        contextDistribution[ctx] = round(cnt / totalCtx, 4);
      }

      const totalPos =
        data.positions.suffix +
        data.positions.prefix +
        data.positions.standalone +
        data.positions.inline || 1;

      return {
        asset,
        raw_count: data.count,
        frequency: totalTexts > 0 ? round(data.count / totalTexts, 4) : 0,
        contexts: Array.from(data.contexts),
        confidence: calculateConfidence(data.count, totalTexts),
        context_distribution: contextDistribution,
        position_style: {
          text_suffix: round(data.positions.suffix / totalPos, 4),
          emoji_prefix: round(data.positions.prefix / totalPos, 4),
          standalone: round(data.positions.standalone / totalPos, 4),
          inline: round(data.positions.inline / totalPos, 4),
        },
      };
    });

  const stickers = Object.entries(stickerStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([asset, data]) => ({
      asset,
      raw_count: data.count,
      frequency: totalTexts > 0 ? round(data.count / totalTexts, 4) : 0,
      contexts: Array.from(data.contexts),
      confidence: calculateConfidence(data.count, totalTexts),
    }));

  const overallEmojiRate = totalTexts > 0 ? round(messagesWithEmojiCount / totalTexts, 4) : 0;
  const characteristicEmojis = emojis.slice(0, 8).map((e) => e.asset);

  return {
    emojis,
    stickers,
    total_emojis_used: emojis.reduce((acc, e) => acc + e.raw_count, 0),
    total_stickers_used: stickers.reduce((acc, s) => acc + s.raw_count, 0),
    emoji_vocabulary_size: emojis.length,
    emoji_probability: overallEmojiRate,
    overall_emoji_rate: overallEmojiRate,
    characteristic_emojis: characteristicEmojis,
  };
}

export function detectContextTags(contextText, targetText) {
  const combined = `${contextText} ${targetText}`.trim();
  const tags = [];

  if (/(?:哈哈|233|逗|笑死|笑出声|好玩|逗比|lol|haha|xd|😂|🤣)/i.test(combined)) tags.push('joking');
  if (/(?:笨蛋|才不|哼|明明|略略略|傲娇|😏|调侃|捉弄|逗你)/i.test(combined)) {
    tags.push('teasing');
    tags.push('teasing_banter');
  }
  if (/(?:爱|喜欢|抱抱|亲亲|比心|想你|暖心|好棒|心疼|🥰|😍|❤️)/i.test(combined)) tags.push('affection');
  if (/(?:好呀|好的呀|好嘞|没问题|同意|赞成|行呀|走起|妥妥|OK|ok|👍|确实|好的|收到)/i.test(combined)) tags.push('agreement');
  if (/(?:想想|琢磨|好奇|思考|分析|为什么|为啥|🤔)/i.test(combined)) tags.push('thinking');
  if (/(?:困|睡了|晚安|累死|撑不住|好累|睡觉|休息|歇歇|😴|🥱|夜深)/i.test(combined)) {
    tags.push('tired_night');
    tags.push('tired_sleep');
  }
  if (/(?:好不好|求求|拜托|好嘛|可以嘛|帮帮|帮我|求你|🥺|QAQ|qwq)/i.test(combined)) tags.push('pleading_cute');
  if (/(?:太棒了|冲|恭喜|稳了|牛哇|厉害|干得漂亮|庆祝|🎉|👏|🍻)/i.test(combined)) tags.push('celebration');
  if (/(?:难过|伤心|哭了|呜呜|委屈|破防|心碎|惨|哭死|😭|😢)/i.test(combined)) tags.push('sadness');
  if (/(?:气死|烦|讨厌|无语|暴躁|抓狂|崩溃|服了|离谱|😡|🤬)/i.test(combined)) tags.push('frustration');
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
