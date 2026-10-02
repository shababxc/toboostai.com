// api/user.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

// আজকের UTC তারিখ বের করার হেল্পার
const getTodayUtc = () => new Date().toISOString().split('T')[0];

// রেফারেল সংখ্যা অনুযায়ী লেভেল বের করার হেল্পার
const calculateLevel = (referrals = 0) => {
  if (referrals >= 20) return 5;
  if (referrals >= 15) return 4;
  if (referrals >= 10) return 3;
  if (referrals >= 5) return 2;
  return 1;
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-telegram-init-data');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = req.headers['x-telegram-init-data'] || body.initData;

    if (!initData) {
      return res.status(401).json({ error: 'Telegram authentication header missing' });
    }

    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) {
      return res.status(401).json({ error: 'Unauthorized Telegram session' });
    }

    const userId = String(auth.user.id);
    const todayUtc = getTodayUtc();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    // ========================================================
    // ১. সম্পূর্ণ নতুন ইউজার হলে (New User Registration)
    // ========================================================
    if (!doc.exists) {
      const rawParam = body.startParam || '';
      let referrerId = '';
      if (rawParam) {
        referrerId = String(rawParam).replace('ref_', '').trim();
      }

      const newUser = {
        userId,
        name: auth.user.first_name || 'User',
        points: 0,
        level: 1,
        referralsCount: 0,
        referredBy: (referrerId && referrerId !== userId) ? referrerId : null,
        // প্রতিদিনের অ্যাড ও টাস্ক কাউন্ট ফায়ারস্টোরে আলাদা সেভ
        adsWatchedToday: 0,
        lastAdDate: todayUtc,
        dailyTasksCompletedToday: 0,
        lastTaskDate: todayUtc,
        // চেক-ইন স্ট্রিক
        checkInStreak: 0,
        lastCheckInDate: null,
        completedTasks: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await userRef.set(newUser);

      // রেফারারকে সাথে সাথে +১০০ পয়েন্ট এবং +১ Fren যোগ করা
      if (referrerId && referrerId !== userId) {
        try {
          const referrerRef = db.collection('users').doc(referrerId);
          await referrerRef.set({
            points: admin.firestore.FieldValue.increment(100),
            referralsCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (refErr) {
          console.error('Error crediting referrer:', refErr);
        }
      }

      return res.status(200).json({ success: true, user: newUser, ...newUser });
    }

    // ========================================================
    // ২. পুরাতন ইউজার হলে (Existing User Login)
    // ========================================================
    let userData = doc.data();
    let updatesNeeded = {};

    // ক) নতুন দিন শুরু হলে অ্যাড কাউন্ট স্বয়ংক্রিয়ভাবে ০ (রিসেট) হবে
    if (userData.lastAdDate !== todayUtc) {
      updatesNeeded.adsWatchedToday = 0;
      updatesNeeded.lastAdDate = todayUtc;
      userData.adsWatchedToday = 0;
      userData.lastAdDate = todayUtc;
    }

    // খ) নতুন দিন শুরু হলে ডেইলি টাস্ক কাউন্ট ০ (রিসেট) হবে
    if (userData.lastTaskDate !== todayUtc) {
      updatesNeeded.dailyTasksCompletedToday = 0;
      updatesNeeded.lastTaskDate = todayUtc;
      userData.dailyTasksCompletedToday = 0;
      userData.lastTaskDate = todayUtc;
    }

    // গ) রেফারেল অনুযায়ী অটো লেভেল আপডেট
    const currentLevel = calculateLevel(userData.referralsCount || 0);
    if (userData.level !== currentLevel) {
      updatesNeeded.level = currentLevel;
      userData.level = currentLevel;
    }

    // ঘ) ইউজারের নাম টেলিগ্রামে পরিবর্তন হলে আপডেট করা
    if (auth.user.first_name && userData.name !== auth.user.first_name) {
      updatesNeeded.name = auth.user.first_name;
      userData.name = auth.user.first_name;
    }

    // কোনো আপডেট থাকলে ফায়ারস্টোরে একবারে সেভ করা
    if (Object.keys(updatesNeeded).length > 0) {
      updatesNeeded.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(updatesNeeded, { merge: true });
    }

    return res.status(200).json({ success: true, user: userData, ...userData });

  } catch (error) {
    console.error('User API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
