const crypto = require('crypto');
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-telegram-init-data');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
    if (!initData) {
      return res.status(401).json({ success: false, error: 'Telegram authentication missing' });
    }

    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized Telegram session' });
    }

    const userId = String(auth.user.id);
    const sessionId = 'ad_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');

    await db.collection('ad_sessions').doc(sessionId).set({
      sessionId,
      userId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    return res.status(200).json({
      success: true,
      sessionId: sessionId,
      sessionToken: sessionId
    });
  } catch (error) {
    console.error('ad-start error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
