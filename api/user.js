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
      let rawParam = body.startParam || '';
      if (!rawParam && initData) {
        try {
          const p = new URLSearchParams(initData);
          rawParam = p.get('start_param') || '';
        } catch (e) {}
      }
      const referrerId = rawParam ? String(rawParam).replace(/^ref_/, '').trim() : '';

      const newUser = {
        userId,
        name: auth.user.first_name || 'User',
        points: 0,
        level: 1,
        referralsCount: 0,
        referrals: 0, // উভয় নামের সাপোর্ট
        referredBy: (referrerId && referrerId !== userId) ? referrerId : null,
        adsWatchedToday: 0,
        lastAdDate: todayUtc,
        dailyTasksCompletedToday: 0,
        lastTaskDate: todayUtc,
        checkInStreak: 0,
        lastCheckInDate: null,
        completedTasks: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await userRef.set(newUser);

      // রেফারারকে সাথে সাথে +১০০ পয়েন্ট এবং +১ রেফারেল যোগ করা
      if (referrerId && referrerId !== userId) {
        try {
          const referrerRef = db.collection('users').doc(referrerId);
          await referrerRef.set({
            points: admin.firestore.FieldValue.increment(100),
            referralsCount: admin.firestore.FieldValue.increment(1),
            referrals: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (refErr) {
          console.error('Error crediting referrer:', refErr);
        }
      }

      return res.status(200).json({ success: true, user: newUser, ...newUser });
    }

    // ========================================================
    // ২. পুরাতন ইউজার হলে (Existing User Login & Auto-Recovery)
    // ========================================================
    let userData = doc.data();
    let updatesNeeded = {};

    // ক) আগের ৮টি রেফারেল যেকোনো ফিল্ড বা নাম থেকে স্বয়ংক্রিয় রিকভার করা
    let currentReferrals = Number(
      userData.referralsCount ??
      userData.referrals ??
      userData.referralCount ??
      (Array.isArray(userData.referrals) ? userData.referrals.length : 0) ??
      0
    );

    // খ) ডাটাবেজে আপনার রেফারেল করা অ্যাকাউন্টগুলো সরাসরি খুঁজে বের করা
    try {
      const refSnapshot = await db.collection('users').where('referredBy', '==', userId).get();
      if (!refSnapshot.empty && refSnapshot.size > currentReferrals) {
        currentReferrals = refSnapshot.size;
        updatesNeeded.referralsCount = currentReferrals;
        updatesNeeded.referrals = currentReferrals;
        userData.referralsCount = currentReferrals;
        userData.referrals = currentReferrals;
      }
    } catch (e) {
      console.warn('Referral recovery check skipped:', e);
    }

    // গ) নতুন দিন শুরু হলে অ্যাড কাউন্ট স্বয়ংক্রিয়ভাবে ০ (রিসেট) হওয়া
    if (userData.lastAdDate !== todayUtc) {
      updatesNeeded.adsWatchedToday = 0;
      updatesNeeded.lastAdDate = todayUtc;
      userData.adsWatchedToday = 0;
      userData.lastAdDate = todayUtc;
    }

    // ঘ) নতুন দিন শুরু হলে ডেইলি টাস্ক কাউন্ট ০ (রিসেট) হওয়া
    if (userData.lastTaskDate !== todayUtc) {
      updatesNeeded.dailyTasksCompletedToday = 0;
      updatesNeeded.lastTaskDate = todayUtc;
      userData.dailyTasksCompletedToday = 0;
      userData.lastTaskDate = todayUtc;
    }

    // ঙ) রেফারেল সংখ্যা অনুযায়ী অটো লেভেল আপডেট (যেমন: ৫ বা ততোধিক হলে Lv.2)
    const currentLevel = calculateLevel(currentReferrals);
    if (userData.level !== currentLevel) {
      updatesNeeded.level = currentLevel;
      userData.level = currentLevel;
    }

    // চ) ইউজারের নাম টেলিগ্রামে পরিবর্তন হলে আপডেট করা
        if (auth.user.first_name && userData.name !== auth.user.first_name) {
          updatesNeeded.name = auth.user.first_name;
          userData.name = auth.user.first_name;
        }

        // ছ) ইউজার ওয়ালেট কানেক্ট করলে ডাটাবেসে সেভ করা
        if (body.walletAddress && userData.walletAddress !== body.walletAddress) {
          updatesNeeded.walletAddress = body.walletAddress;
          userData.walletAddress = body.walletAddress;
        }

        // জ) কোনো আপডেট থাকলে ফায়ারস্টোরে সেভ করা
        if (Object.keys(updatesNeeded).length > 0) {
          updatesNeeded.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await userRef.set(updatesNeeded, { merge: true });
        }

    // ফ্রন্টএন্ডে ডেটা পাঠানোর সময় withdrawCount যুক্ত করা হলো
    // 🌟 আপনার রেফারে জয়েন করা বন্ধুদের তালিকা (Team Members) সংগ্রহ করা
        let teamMembers = [];
        try {
          const teamSnap = await db.collection('users').where('referredBy', '==', String(userId)).get();
          if (!teamSnap.empty) {
            teamSnap.forEach(doc => {
              const mem = doc.data() || {};
              teamMembers.push({
                userId: String(mem.userId || doc.id),
                name: mem.name || 'Fren',
                username: mem.username || null,
                avatarUrl: mem.photo_url || null,
                points: Number(mem.points ?? mem.balance ?? 0),
                lv2Count: Number(mem.referralsCount ?? mem.referrals ?? 0),
                lv2Points: Math.round(Number(mem.referralsCount ?? mem.referrals ?? 0) * 100) // Lv2 বোনাস পয়েন্ট
              });
            });
          }
        } catch (e) {
          console.error('Error fetching team members:', e);
        }

        const finalResponse = {
          ...userData,
          referralsCount: currentReferrals,
          referrals: currentReferrals,
          level: currentLevel,
          withdrawCount: userData.withdrawCount || 0,
          savedStreaks: userData.savedStreaks || 0,
          savedAdDays: userData.savedAdDays || 0,
          teamMembers: teamMembers
        };
    return res.status(200).json({ success: true, user: finalResponse, ...finalResponse });

  } catch (error) {
    console.error('User API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
