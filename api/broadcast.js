// api/broadcast.js
const { db } = require('./_firebase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = 'https://toboostaicom-web3.vercel.app';

// 🔥 গতকালের সেই ফিক্সড ছবি, লেখা এবং বাটন
const DEFAULT_PHOTO = 'https://i.postimg.cc/s2q0bhg9/20261006-192711.jpg';
const DEFAULT_BUTTON = '🌟 TO BOOSTAI NOW';
const DEFAULT_CAPTION = `⚡️Don’t miss out — fresh sponsors just arrived, and new rewards are already live! 
💎Your activity keeps the momentum growing.
The more you return, the more tasks and $GRAM opportunities unlock for everyone.
🚀 Come back now and grab your new rewards!`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
  if (!adminKey || adminKey !== (process.env.ADMIN_SECRET_KEY || 'TOBOOST_SECRET_2025')) {
    return res.status(401).json({ error: 'Unauthorized Admin' });
  }

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is missing' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    
    // মোড নির্বাচন: ১-ক্লিক ফিক্সড মোড নাকি কাস্টম মোড
    const isDefaultMode = body.mode === 'default' || !body.caption;

    const mediaUrl = isDefaultMode ? DEFAULT_PHOTO : (body.mediaUrl ? String(body.mediaUrl).trim() : '');
    const caption = isDefaultMode ? DEFAULT_CAPTION : String(body.caption).trim();
    const buttonText = isDefaultMode ? DEFAULT_BUTTON : (body.buttonText ? String(body.buttonText).trim() : DEFAULT_BUTTON);

    const usersSnapshot = await db.collection('users').get();
    if (usersSnapshot.empty) {
      return res.status(200).json({ success: true, message: 'No users found to broadcast.' });
    }

    const userIds = [];
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      const uid = data.userId || doc.id;
      if (uid && !isNaN(uid)) userIds.push(uid);
    });

    const isVideoOrGif = mediaUrl.match(/\.(mp4|gif|mov|webm)(\?.*)?$/i);
    const telegramMethod = isVideoOrGif ? 'sendAnimation' : (mediaUrl ? 'sendPhoto' : 'sendMessage');

    let successCount = 0;
    let failedCount = 0;

    for (const userId of userIds) {
      try {
        let payload = {
          chat_id: userId,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: buttonText,
                  web_app: { url: WEB_APP_URL }
                }
              ]
            ]
          }
        };

        if (isVideoOrGif) {
          payload.animation = mediaUrl;
          payload.caption = caption;
        } else if (mediaUrl) {
          payload.photo = mediaUrl;
          payload.caption = caption;
        } else {
          payload.text = caption;
        }

        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${telegramMethod}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.ok) successCount++;
        else failedCount++;

        await new Promise(resolve => setTimeout(resolve, 40));
      } catch (err) {
        failedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `🎉 Broadcast sent successfully! (Sent: ${successCount}, Failed/Blocked: ${failedCount})`,
      successCount,
      failedCount
    });

  } catch (error) {
    console.error('Broadcast Error:', error);
    return res.status(500).json({ error: error.message || 'Broadcast failed' });
  }
};
