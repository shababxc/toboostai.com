// api/broadcast.js
const { db } = require('./_firebase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = 'https://toboostaicom-web3.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // অ্যাডমিন অথেনটিকেশন চেক
  const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
  if (!adminKey || adminKey !== (process.env.ADMIN_SECRET_KEY || 'TOBOOST_SECRET_2025')) {
    return res.status(401).json({ error: 'Unauthorized Admin' });
  }

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is missing' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    
    // অ্যাডমিন প্যানেল থেকে পাঠানো ডায়নামিক মেসেজ ও মিডিয়া
    const mediaUrl = body.mediaUrl ? String(body.mediaUrl).trim() : '';
    const caption = body.caption ? String(body.caption).trim() : '⚡ New update is live on ToBOOSTAi! Check it out now.';
    const buttonText = body.buttonText ? String(body.buttonText).trim() : '✨ TO BOOSTAi NOW';

    // ডাটাবেস থেকে সব ইউজারের টেলিগ্রাম আইডি সংগ্রহ
    const usersSnapshot = await db.collection('users').get();
    if (usersSnapshot.empty) {
      return res.status(200).json({ success: true, message: 'No users found to broadcast.' });
    }

    const userIds = [];
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      const uid = data.userId || doc.id;
      if (uid && !isNaN(uid)) {
        userIds.push(uid);
      }
    });

    // মিডিয়া টাইপ অটো-ডিটেক্ট করা (ভিডিও/GIF নাকি সাধারণ ছবি)
    const isVideoOrGif = mediaUrl.match(/\.(mp4|gif|mov|webm)(\?.*)?$/i);
    const telegramMethod = isVideoOrGif ? 'sendAnimation' : (mediaUrl ? 'sendPhoto' : 'sendMessage');

    let successCount = 0;
    let failedCount = 0;

    // সব ইউজারের কাছে মেসেজ পাঠানো
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

        // টেলিগ্রাম রেট লিমিট এড়াতে ছোট বিরতি
        await new Promise(resolve => setTimeout(resolve, 40));
      } catch (err) {
        failedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `🎉 Broadcast sent! (Success: ${successCount}, Failed/Blocked: ${failedCount})`,
      successCount,
      failedCount
    });

  } catch (error) {
    console.error('Broadcast Error:', error);
    return res.status(500).json({ error: error.message || 'Broadcast failed' });
  }
};
