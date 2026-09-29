// api/ad-start.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // হেডার অথবা বডি—দুটো থেকেই পড়া যাবে
    const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
    if (!initData) return res.status(401).json({ error: 'Missing Telegram authentication' });

    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) return res.status(401).json({ error: 'Unauthorized' });

    const userId = String(auth.user.id);

    const sessionRef = await db.collection('ad_sessions').add({
      userId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // sessionId এবং sessionToken দুটো নামেই রিটার্ন যাতে কোনো ফ্রন্টএন্ড কনফ্লিক্ট না থাকে
    return res.status(200).json({
      success: true,
      sessionId: sessionRef.id,
      sessionToken: sessionRef.id
    });
  } catch (err) {
    console.error('ad-start error:', err);
    return res.status(500).json({ error: 'Failed to create ad session' });
  }
};
