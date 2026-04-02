import { Config } from '../types';

export async function sendTelegramNotification(message: string, config: Config): Promise<void> {
  if (!config.telegram_bot_token || !config.telegram_chat_id) {
    console.warn('Telegram notification skipped: Bot token or chat ID missing.');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.telegram_chat_id,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Telegram API error:', errorData);
    }
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
  }
}
