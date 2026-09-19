/**
 * EIDOLON Layer 5: Emoji & Sticker Model
 * Implements Section 14 of the specification.
 */

export function extractAssetModels(texts, turns = []) {
  const emojiStats = {};
  const stickerStats = {};
  const totalTexts = texts.length;

  // Unicode Emoji Regex matching emojis, variations, modifiers
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  // Sticker text pattern in chat exports
  const stickerPattern = /\[(?:sticker|表情包|动画表情|动画贴图)[^\]]*\]/gi;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const correspondingTurn = turns[i];
    const contextText = correspondingTurn
      ? correspondingTurn.context.map((c) => c.content).join(' ')
      : '';

    // Context tag detection
    const contexts = detectContextTags(contextText, text);

    // 1. Emojis
    let match;
    while ((match = emojiRegex.exec(text)) !== null) {
      const emoji = match[0];
      if (!emojiStats[emoji]) {
        emojiStats[emoji] = { count: 0, contexts: new Set() };
      }
      emojiStats[emoji].count++;
      contexts.forEach((ctx) => emojiStats[emoji].contexts.add(ctx));
    }

    // 2. Stickers
    let stickerMatch;
    while ((stickerMatch = stickerPattern.exec(text)) !== null) {
      const sticker = stickerMatch[0];
      if (!stickerStats[sticker]) {
        stickerStats[sticker] = { count: 0, contexts: new Set() };
      }
      stickerStats[sticker].count++;
      contexts.forEach((ctx) => stickerStats[sticker].contexts.add(ctx));
    }
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

function detectContextTags(contextText, targetText) {
  const combined = `${contextText} ${targetText}`;
  const tags = [];

  if (/(哈哈|233|逗|笑|lol|haha)/i.test(combined)) tags.push('joking');
  if (/(对|好的|行|嗯嗯|没问题|同意|赞成)/i.test(combined)) tags.push('agreement');
  if (/(难过|伤心|哭|呜呜|委屈|破防)/i.test(combined)) tags.push('sadness');
  if (/(气死|烦|讨厌|无语|暴躁)/i.test(combined)) tags.push('frustration');
  if (/(爱|喜欢|抱抱|亲亲|比心|暖)/i.test(combined)) tags.push('affection');
  if (/(早|晚安|拜拜|在吗|哈喽)/i.test(combined)) tags.push('greeting_closing');

  if (tags.length === 0) tags.push('casual_chat');
  return tags;
}

function calculateConfidence(count, total) {
  // Wilson score or frequency-based confidence
  if (count <= 1) return 0.60;
  if (count <= 3) return 0.75;
  if (count <= 10) return 0.88;
  return 0.95;
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
