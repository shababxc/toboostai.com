// api/reward.js
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

    const userId = String(user.id);

    // 3. Read sessionId or sessionToken from request body
    const sessionId = req.body && (req.body.sessionId || req.body.sessionToken);
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing sessionId or sessionToken' });
    }

    const sessionRef = db.collection('ad_sessions').doc(sessionId);
    const userRef = db.collection('users').doc(userId);
    const REWARD_AMOUNT = 100;

    // 4. Atomic verification and balance increment via Firestore Transaction
    await db.runTransaction(async (transaction) => {
      const sessionDoc = await transaction.get(sessionRef);

      if (!sessionDoc.exists) {
        throw new Error('Invalid ad session');
      }

      const sessionData = sessionDoc.data();

      if (sessionData.userId !== userId) {
        throw new Error('Session does not belong to this user');
      }

      if (sessionData.status === 'completed') {
        throw new Error('Reward has already been claimed for this ad session');
      }

      if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
        throw new Error('Ad session expired. Please watch the ad again.');
      }

      // Mark session completed
      transaction.update(sessionRef, {
        status: 'completed',
        rewardAmount: REWARD_AMOUNT,
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Credit 100 coins to user
      transaction.set(userRef, {
        id: userId,
        balance: admin.firestore.FieldValue.increment(REWARD_AMOUNT),
        totalEarned: admin.firestore.FieldValue.increment(REWARD_AMOUNT),
        adsWatched: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return res.status(200).json({
      success: true,
      reward: REWARD_AMOUNT,
      message: `Reward credited successfully! +${REWARD_AMOUNT} coins.`
    });

  } catch (error) {
    console.error('reward error:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to claim reward' });
  }
};
