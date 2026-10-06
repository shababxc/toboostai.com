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
    const sessionId = req.body && (req.body.sessionId || req.body.sessionToken);

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing session token' });
    }

    const sessionRef = db.collection('ad_sessions').doc(sessionId);
    const userRef = db.collection('users').doc(userId);
    const REWARD_POINTS = 100;

    let updatedPoints = 0;

    await db.runTransaction(async (transaction) => {
      const sessionDoc = await transaction.get(sessionRef);
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        if (sessionData.status === 'completed') {
          throw new Error('Reward already claimed');
        }
      }

      const userDoc = await transaction.get(userRef);
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const currentPoints = userData.points || 0;
    updatedPoints = currentPoints + REWARD_POINTS;

    transaction.set(sessionRef, {
      status: 'completed',
      rewardAmount: REWARD_POINTS,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const todayUtc = new Date().toISOString().split('T')[0];
    const isSameDay = userData.lastAdDate === todayUtc;
    const currentAds = isSameDay ? (userData.adsWatchedToday || 0) : 0;
    const nextAdCount = Math.min(10, currentAds + 1);

    let savedAdDays = userData.savedAdDays || 0;
    // আজকের ১০টি অ্যাড দেখা সম্পন্ন হলে ১ দিন সেভ হবে
    if (nextAdCount === 10 && currentAds < 10) {
      savedAdDays += 1;
    }

    transaction.set(userRef, {
      userId,
      points: admin.firestore.FieldValue.increment(REWARD_POINTS),
      adsWatchedToday: nextAdCount,
      savedAdDays: savedAdDays,
      lastAdDate: todayUtc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

    return res.status(200).json({
      success: true,
      reward: REWARD_POINTS,
      points: updatedPoints,
      balance: updatedPoints,
      message: `Reward credited! +${REWARD_POINTS} PTS`
    });
  } catch (error) {
    console.error('reward error:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to claim reward' });
  }
};
