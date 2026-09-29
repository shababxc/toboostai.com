// api/daily-checkin.js
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
    // 1. Extract Telegram initData (from Header or Body)
    const initData = req.headers['x-telegram-init-data'] || 
                     req.headers['telegram-init-data'] || 
                     (req.body && req.body.initData);

    if (!initData) {
      return res.status(401).json({ success: false, error: 'Missing Telegram authentication data' });
    }

    // 2. Cryptographic Telegram Verification
    const user = await verifyInitData(initData);
    if (!user || !user.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Telegram initData' });
    }

    const userId = String(user.id);
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // 3. Date & Streak Calculation (UTC based)
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Already checked in today?
    if (userData.lastCheckInDate === todayStr) {
      return res.status(200).json({
        success: false,
        alreadyCheckedIn: true,
        message: 'You have already checked in today! Come back tomorrow.'
      });
    }

    // Determine streak
    let newStreak = 1;
    if (userData.lastCheckInDate === yesterdayStr) {
      newStreak = (userData.checkInStreak || 0) + 1;
    }

    const REWARD_AMOUNT = 100;

    // 4. Update Firestore
    await userRef.set({
      id: userId,
      balance: admin.firestore.FieldValue.increment(REWARD_AMOUNT),
      totalEarned: admin.firestore.FieldValue.increment(REWARD_AMOUNT),
      lastCheckInDate: todayStr,
      lastCheckInTime: admin.firestore.FieldValue.serverTimestamp(),
      checkInStreak: newStreak,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const currentBalance = (userData.balance || 0) + REWARD_AMOUNT;

    return res.status(200).json({
      success: true,
      reward: REWARD_AMOUNT,
      streak: newStreak,
      balance: currentBalance,
      message: `Daily check-in successful! +${REWARD_AMOUNT} coins awarded.`
    });

  } catch (error) {
    console.error('daily-checkin error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
