const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

const REWARD_AMOUNT = 50; // প্রতি অ্যাডের জন্য কত পয়েন্ট দিতে চান

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const initData = req.headers['x-telegram-init-data'];
  const auth = verifyTelegramWebAppData(initData);
  if (!auth || !auth.user) return res.status(401).json({ error: 'Unauthorized' });

  const userId = String(auth.user.id);
  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

  const sessionRef = db.collection('ad_sessions').doc(sessionId);
  const userRef = db.collection('users').doc(userId);

  try {
    await db.runTransaction(async (t) => {
      const sessionDoc = await t.get(sessionRef);
      if (!sessionDoc.exists) throw new Error('Invalid ad session');

      const session = sessionDoc.data();
      if (session.userId !== userId || session.status !== 'pending') {
        throw new Error('Reward already claimed or session expired');
      }

      // সেশন ক্লোজ করা
      t.update(sessionRef, { 
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // ইউজারের পয়েন্ট বাড়ানো
      t.set(userRef, {
        points: admin.firestore.FieldValue.increment(REWARD_AMOUNT),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return res.status(200).json({ success: true, added: REWARD_AMOUNT });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};
