// api/_telegram.js
const crypto = require('crypto');

function verifyTelegramWebAppData(initData) {
  if (!initData) return null;

  // TELEGRAM_BOT_TOKEN অথবা BOT_TOKEN যেকোনো নামে ভেরিয়েবল থাকুক না কেন কাজ করবে
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken) {
    console.error('Bot token missing: Please set TELEGRAM_BOT_TOKEN in Vercel');
    return null;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return null;

    urlParams.delete('hash');
    const params = Array.from(urlParams.entries());
    params.sort(([a], [b]) => a.localeCompare(b));

    const dataCheckString = params.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');
    const hashBuffer = Buffer.from(hash, 'hex');

    if (calculatedBuffer.length !== hashBuffer.length || !crypto.timingSafeEqual(calculatedBuffer, hashBuffer)) {
      console.warn('Telegram signature mismatch');
      return null;
    }

    const userStr = urlParams.get('user');
    const user = userStr ? JSON.parse(userStr) : null;
    return { user };
  } catch (err) {
    console.error('Error verifying Telegram data:', err);
    return null;
  }
}

module.exports = { verifyTelegramWebAppData };
