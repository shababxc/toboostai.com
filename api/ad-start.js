// api/ad-start.js
const crypto = require('crypto');
const firebaseModule = require('./_firebase');
const db = firebaseModule.db || firebaseModule;
const admin = firebaseModule.admin || require('firebase-admin');

const telegramHelper = require('./_telegram');
const verifyInitData = typeof telegramHelper === 'function'
  ? telegramHelper
  : (telegramHelper.verifyInitData || telegramHelper.verifyTelegram || telegramHelper.verifyTelegramWebAppData || telegramHelper.validateInitData);

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-telegram-init-data');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // 1. Safe read initData from headers or body
    const initData = req.headers['x-telegram-init-data'] || 
                     req.headers['telegram-init-data'] || 
                     (req.body && req.body.initData);

    if (!initData) {
      return res.status(401).json({ success: false, error: 'Missing Telegram authentication data' });
    }

    // 2. Verify Telegram user
    const user = await verifyInitData(initData);
    if (!user || !user.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Telegram initData' });
    }

    // 3. Generate Ad Session ID
    const sessionId = 'ad_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');

    // 4. Save pending session in Firestore (expires in 10 minutes)
    await db.collection('ad_sessions').doc(sessionId).set({
      sessionId: sessionId,
      userId: String(user.id),
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    // Return both sessionId and sessionToken for 100% compatibility
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
