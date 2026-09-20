/**
 * Telegram API client utility for CLI operations
 */
export async function verifyBotToken(token) {
  if (!token) {
    return { ok: false, error: 'Token is empty' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result) {
      return {
        ok: true,
        id: data.result.id,
        username: data.result.username,
        firstName: data.result.first_name,
      };
    }
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendTelegramMessage(token, chatId, text, replyToMsgId = 0) {
  if (!token || !chatId) return null;
  const payload = {
    chat_id: chatId,
    text,
  };
  if (replyToMsgId > 0) {
    payload.reply_parameters = { message_id: replyToMsgId };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok && data.result) {
      return data.result.message_id;
    }
  } catch (_) {}
  return null;
}

export async function deleteTelegramMessage(token, chatId, messageId) {
  if (!token || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    });
    const data = await res.json();
    return Boolean(data.ok);
  } catch (_) {
    return false;
  }
}
