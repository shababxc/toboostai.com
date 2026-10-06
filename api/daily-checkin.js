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
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Already checked in today?
    if (userData.lastCheckInDate === todayStr) {
      return res.status(200).json({
        success: false,
        alreadyCheckedIn: true,
        points: userData.points || 0,
        streak: userData.checkInStreak || 1,
        message: 'You have already checked in today! Come back tomorrow.'
      });
    }

    // Determine streak & saved streaks
    let newStreak = 1;
    let savedStreaks = userData.savedStreaks || 0;

    if (userData.lastCheckInDate === yesterdayStr) {
      newStreak = (userData.checkInStreak || 0) + 1;
    }

    // ৭ দিন পূর্ণ হলে সংরক্ষিত স্ট্রিকে ১ জমা হবে এবং নতুন স্ট্রিক ০ হবে
    let displayStreak = newStreak;
    if (newStreak >= 7) {
      savedStreaks += 1;
      newStreak = 0;
      displayStreak = 7;
    }

    const REWARD_POINTS = displayStreak === 7 ? 250 : 100;
    const newTotalPoints = (userData.points || 0) + REWARD_POINTS;

    await userRef.set({
      userId,
      name: auth.user.first_name || userData.name || 'User',
      points: admin.firestore.FieldValue.increment(REWARD_POINTS),
      lastCheckInDate: todayStr,
      lastCheckInTime: admin.firestore.FieldValue.serverTimestamp(),
      checkInStreak: newStreak,
      savedStreaks: savedStreaks,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({
      success: true,
      reward: REWARD_POINTS,
      streak: displayStreak,
      points: newTotalPoints,
      balance: newTotalPoints,
      message: `Daily check-in successful! +${REWARD_POINTS} PTS awarded.`
    });
  } catch (error) {
    console.error('daily-checkin error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
