// api/webhook.js

export default async function handler(req, res) {
  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is active!');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!update) {
      return res.status(200).json({ ok: true });
    }

    // BOT_TOKEN বা TELEGRAM_BOT_TOKEN যেকোনো একটি থাকলেই কাজ করবে
    const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error('Bot Token is missing in Environment Variables');
      return res.status(200).json({ ok: true });
    }

    // ========================================================
    // ১. TELEGRAM STARS PRE-CHECKOUT QUERY (সবচেয়ে গুরুত্বপূর্ণ)
    // ইউজার যখন Stars পেমেন্ট কনফার্ম করে, তখন টেলিগ্রাম এটি পাঠায়
    // ========================================================
    if (update.pre_checkout_query) {
      const preCheckoutQueryId = update.pre_checkout_query.id;

      // টেলিগ্রামকে পেমেন্ট অনুমোদনের সিগন্যাল পাঠানো (ok: true)
      await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutQueryId,
          ok: true // অনুমোদন কনফার্ম করা হলো
        })
      });

      return res.status(200).json({ ok: true });
    }

    // ========================================================
    // ২. SUCCESSFUL PAYMENT NOTIFICATION (পেমেন্ট সফল হলে)
    // ========================================================
    if (update.message && update.message.successful_payment) {
      const payment = update.message.successful_payment;
      const chatId = update.message.chat.id;

      // ইউজারকে পেমেন্ট সাকসেস মেসেজ পাঠানো
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `⭐️ *Payment Successful!*\n\nYou paid *${payment.total_amount} Stars*.\nYour bounty campaign has been published successfully on ToBOOSTAi! 🚀`,
          parse_mode: 'Markdown'
        })
      });

      return res.status(200).json({ ok: true });
    }

    // ========================================================
    // ৩. /start কমান্ড হ্যান্ডলিং (ওয়েলকাম মেসেজ ও 👉WORK NOW👈 বাটন)
    // ========================================================
    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const { chat, text } = update.message;
      const parts = text.trim().split(/\s+/);
      const startParam = parts[1] || ''; // e.g. "ref_12345678"

      // আপনার নতুন Vercel সাইট ও রেফারেল ট্র্যাকিং লিঙ্ক
      const webAppBaseUrl = 'https://toboostaicom-web3.vercel.app';
      const webAppUrl = startParam 
        ? `${webAppBaseUrl}?tgWebAppStartParam=${encodeURIComponent(startParam)}`
        : webAppBaseUrl;

      // আপনার দেওয়া হুবহু টেক্সট
      const welcomeText = `🎉Welcome to ToBOOSTAi!🎉\nDon't waste time! ToBOOSTAi \nStart completing tasks to earn points!\nOr publish your tasks to gain exposure!\nReady? Then let’s get started!`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat.id,
          text: welcomeText,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '👉WORK NOW👈',
                  web_app: { url: webAppUrl }
                }
              ]
            ]
          }
        })
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true });
  }
}
