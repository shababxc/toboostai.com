// api/webhook.js
module.exports = async function handler(req, res) {
  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is active!');
  }

  try {
    const update = req.body;
    if (!update || !update.message) {
      return res.status(200).json({ ok: true });
    }

    const { chat, text, from } = update.message;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN is missing');
      return res.status(200).json({ ok: true });
    }

    // Check if user clicked START or sent /start
    if (text && text.startsWith('/start')) {
      const parts = text.trim().split(/\s+/);
      const startParam = parts[1] || ''; // e.g. "ref_12345678"

      // App launch link with referral
      const appUrl = startParam 
        ? `https://t.me/ToFarmsAi_Bot?startapp=${encodeURIComponent(startParam)}`
        : `https://t.me/ToFarmsAi_Bot?startapp=app`;

      const safeName = (from && from.first_name) ? from.first_name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '') : 'Friend';

      const welcomeText = `👋 Hello *${safeName}*!\n\nWelcome to *ToBOOSTAi* 🚀\n\nEarn points, complete bounties, watch ads, and invite friends to boost your rewards.\n\n👇 Click the button below to launch the app:`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat.id,
          text: welcomeText,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🚀 Launch App',
                  url: appUrl
                }
              ]
            ]
          }
        })
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true });
  }
};
