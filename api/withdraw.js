// api/withdraw.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-init-data');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = req.headers['x-telegram-init-data'] || body.initData;

    if (!initData) return res.status(401).json({ success: false, error: 'Auth missing' });
    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const userId = String(auth.user.id);
    const walletAddress = body.walletAddress;

    if (!walletAddress) return res.status(400).json({ success: false, error: 'Wallet address required' });

    const userRef = db.collection('users').doc(userId);
    let nextWithdrawCount = 0;
    let requiredPts = 0;

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) throw new Error('User not found');
      
      const userData = userDoc.data();
      const currentWithdrawCount = userData.withdrawCount || 0;
      
      // লিমিট ক্যালকুলেশন: 10k, 20k, 30k... (যতবার করবে তত বাড়বে)
      const currentTier = currentWithdrawCount + 1;
      requiredPts = currentTier * 10000;

      const savedStreaks = userData.savedStreaks || 0;
      const currentStreak = userData.checkInStreak || 0;
      const savedAdDays = userData.savedAdDays || 0;

      // ১. পয়েন্ট ব্যালেন্স চেক
      if ((userData.points || 0) < requiredPts) {
        throw new Error(`Insufficient points! You need ${requiredPts.toLocaleString()} PTS.`);
      }

      // ২. ৭ দিনের চেক-ইন শর্ত যাচাই
      if (savedStreaks < 1 && currentStreak < 7) {
        throw new Error('Withdrawal locked! You must complete a 7-Day Check-in Streak.');
      }

      // ৩. ৭ দিনের (৭০টি) অ্যাড দেখার শর্ত যাচাই
      if (savedAdDays < 7) {
        throw new Error(`Withdrawal locked! You must watch 10 Ads daily for 7 days (Completed: ${savedAdDays}/7 days).`);
      }

      nextWithdrawCount = currentWithdrawCount + 1;

      // ৪. পয়েন্ট কাটা, উইথড্র কাউন্ট +১ এবং পরবর্তী উইথড্রর জন্য ১টি স্ট্রিক ও ৭ দিনের অ্যাড মাইনাস করা
      const updatedStreaks = savedStreaks > 0 ? savedStreaks - 1 : 0;
      const updatedStreakDays = savedStreaks > 0 ? currentStreak : 0;
      const updatedAdDays = Math.max(0, savedAdDays - 7);

      transaction.set(userRef, {
        points: admin.firestore.FieldValue.increment(-requiredPts),
        withdrawCount: admin.firestore.FieldValue.increment(1),
        savedStreaks: updatedStreaks,
        checkInStreak: updatedStreakDays,
        savedAdDays: updatedAdDays,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      // ২. উইথড্র রিকোয়েস্টটি ডাটাবেজে সেভ করে রাখা (যাতে আপনি পরে পেমেন্ট দিতে পারেন)
      const withdrawRef = db.collection('withdrawals').doc();
      transaction.set(withdrawRef, {
        userId: userId,
        username: auth.user.first_name || 'User',
        walletAddress: walletAddress,
        amountPts: requiredPts,
        amountGram: requiredPts / 10000,
        tier: currentTier,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    // সফল হলে ফ্রন্টএন্ডে মেসেজ পাঠানো
    return res.status(200).json({
      success: true,
      newWithdrawCount: nextWithdrawCount,
      message: `Tier ${nextWithdrawCount} completed! Next withdrawal requires ${(nextWithdrawCount + 1) * 10000} PTS.`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    return res.status(400).json({ success: false, error: error.message || 'Withdrawal failed' });
  }
};
