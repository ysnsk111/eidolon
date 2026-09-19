import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { normalizeMessages } from './normalize.js';

export function parseHtmlChat(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseHtmlString(content, options);
}

export function parseHtmlString(htmlString, options = {}) {
  const $ = cheerio.load(htmlString);
  const rawMessages = [];

  // Telegram Desktop HTML Export Structure:
  // <div class="message default clearfix" id="message123">
  //   <div class="from_name">Alice</div>
  //   <div class="date details" title="14.05.2026 10:22:15 UTC+08:00">10:22</div>
  //   <div class="text">Message body</div>
  // </div>
  let currentSender = 'Unknown';

  $('.message').each((i, el) => {
    const $el = $(el);
    const id = $el.attr('id') || `html_msg_${i + 1}`;

    const fromNameEl = $el.find('.from_name');
    if (fromNameEl.length > 0) {
      currentSender = fromNameEl.text().trim();
    }

    const dateTitle = $el.find('.date').attr('title') || $el.find('.date').text().trim();
    const text = $el.find('.text').text().trim();

    if (text) {
      rawMessages.push({
        id,
        timestamp: dateTitle || new Date().toISOString(),
        sender: currentSender,
        content: text,
        replyToId: null,
        raw: $el.html() || text,
      });
    }
  });

  // Fallback if no .message elements found: search generic bubbles / divs
  if (rawMessages.length === 0) {
    $('.chat-message, .bubble, [data-sender]').each((i, el) => {
      const $el = $(el);
      const sender = $el.attr('data-sender') || $el.find('.sender, .author, .user').text().trim() || 'Speaker';
      const text = $el.find('.content, .text, .body').text().trim() || $el.text().trim();
      const time = $el.find('.time, .timestamp, .date').text().trim() || new Date().toISOString();

      if (text) {
        rawMessages.push({
          id: `html_${i + 1}`,
          timestamp: time,
          sender,
          content: text,
          raw: $el.html() || text,
        });
      }
    });
  }

  return normalizeMessages(rawMessages, options);
}
