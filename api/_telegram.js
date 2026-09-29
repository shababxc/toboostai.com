const crypto = require('crypto');

function verifyTelegramWebAppData(initData) {
  if (!initData) return null;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return null;

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
    return null;
  }

  const user = urlParams.get('user') ? JSON.parse(urlParams.get('user')) : null;
  return { user };
}

module.exports = { verifyTelegramWebAppData };
