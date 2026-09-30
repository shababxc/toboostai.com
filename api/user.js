// api/user.js
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
      return res.status(401).json({ error: 'Telegram authentication header missing' });
    }

    const auth = verifyTelegramWebAppData(initData);
    if (!auth || !auth.user) {
      return res.status(401).json({ error: 'Unauthorized Telegram session' });
    }

    const userId = String(auth.user.id);
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    // ১. সম্পূর্ণ নতুন ইউজার হলে (New User Registration)
    if (!doc.exists) {
      const rawParam = (req.body && req.body.startParam) || '';
      let referrerId = '';
      if (rawParam) {
        referrerId = String(rawParam).replace('ref_', '').trim();
      }

      const newUser = {
        userId,
        name: auth.user.first_name || 'User',
        points: 0,
        referralsCount: 0,
        referredBy: (referrerId && referrerId !== userId) ? referrerId : null,
        completedTasks: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
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

      return res.status(200).json(newUser);
    }

    // পুরাতন ইউজার হলে ফায়ারবেস থেকে পয়েন্ট ও কমপ্লিট টাস্ক পাঠানো
    return res.status(200).json(doc.data());

  } catch (error) {
    console.error('User API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
