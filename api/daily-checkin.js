// api/daily-checkin.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // হেডার অথবা বডি—দুটো থেকেই ডাটা রিসিভ করার নিরাপদ ব্যবস্থা
    const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
    if (!initData) return res.status(401).json({ error: 'Missing Telegram authentication' });

    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) return res.status(401).json({ error: 'Unauthorized user' });

    const userId = String(auth.user.id);
    const userRef = db.collection('users').doc(userId);

    const DAILY_BONUS_POINTS = 100;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error('User not found. Please reload app.');
      }

      const userData = userDoc.data();
      const lastCheckInDate = userData.lastCheckInDate || null;

      // ইউজার কি আজ ইতিমধ্যে ক্লেইম করেছেন?
      if (lastCheckInDate === todayStr) {
        return {
          alreadyClaimed: true,
          points: userData.points || 0,
          streak: userData.checkInStreak || 1
        };
      }

      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      let streak = userData.checkInStreak || 0;
      if (lastCheckInDate === yesterdayStr) {
        streak += 1;
      } else {
        streak = 1;
      }

      const newPoints = (userData.points || 0) + DAILY_BONUS_POINTS;

      transaction.update(userRef, {
        points: newPoints,
        lastCheckInDate: todayStr,
        lastCheckInAt: admin.firestore.FieldValue.serverTimestamp(),
        checkInStreak: streak
      });

      return {
        alreadyClaimed: false,
        addedPoints: DAILY_BONUS_POINTS,
        totalPoints: newPoints,
        streak
      };
    });

    if (result.alreadyClaimed) {
      return res.status(400).json({
        success: false,
        message: 'Already claimed today! Come back tomorrow.',
        points: result.points,
        streak: result.streak
      });
    }

    return res.status(200).json({
      success: true,
      message: `🎉 +${result.addedPoints} PTS claimed! (Streak: ${result.streak} Days)`,
      points: result.totalPoints,
      streak: result.streak
    });
  } catch (err) {
    console.error('Daily checkin error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process daily checkin' });
  }
};
