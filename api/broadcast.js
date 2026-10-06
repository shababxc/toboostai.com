// api/broadcast.js
const { db } = require('./_firebase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = 'https://toboostaicom-web3.vercel.app';

// 🔥 আপনার এই নতুন এডিটেড ছবির ডিরেক্ট লিঙ্কটি এখানে বসাবেন
const PHOTO_URL = 'https://i.postimg.cc/s2q0bhg9/20261006-192711.jpg';

// আপনার দেওয়া হুবহু টেক্সট
const BROADCAST_CAPTION = `⚡️Don’t miss out — fresh sponsors just arrived, and new rewards are already live! 
💎Your activity keeps the momentum growing.
The more you return, the more tasks and $GRAM opportunities unlock for everyone.
🚀 Come back now and grab your new rewards!`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // অ্যাডমিন সিক্রেট কি সিকিউরিটি চেক
  const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
  if (!adminKey || adminKey !== (process.env.ADMIN_SECRET_KEY || 'TOBOOST_SECRET_2025')) {
    return res.status(401).json({ error: 'Unauthorized Admin' });
  }

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is missing' });
  }

  try {
    // ফায়ারস্টোর ডাটাবেস থেকে সব রেজিস্টার্ড ইউজারের আইডি নেওয়া
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

    let successCount = 0;
    let failedCount = 0;

    // প্রতিটি ইউজারের কাছে ছবি, ক্যাপশন ও '🌟 TO BOOSTAI NOW' বাটন পাঠানো
    for (const userId of userIds) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userId,
            photo: PHOTO_URL,
            caption: BROADCAST_CAPTION,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🌟 TO BOOSTAI NOW',
                    web_app: { url: WEB_APP_URL }
                  }
                ]
              ]
            }
          })
        });

        const data = await response.json();
        if (data.ok) successCount++;
        else failedCount++;

        // টেলিগ্রাম রেট লিমিট সেফটি বিরতি (৫০ মিলিসেকেন্ড)
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        failedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `🎉 Broadcast sent successfully! (Sent: ${successCount}, Blocked: ${failedCount})`,
      successCount,
      failedCount
    });

  } catch (error) {
    console.error('Broadcast Error:', error);
    return res.status(500).json({ error: error.message || 'Broadcast failed' });
  }
};
