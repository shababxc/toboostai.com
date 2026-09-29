const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const initData = req.headers['x-telegram-init-data'];
  const auth = verifyTelegramWebAppData(initData);
  if (!auth || !auth.user) return res.status(401).json({ error: 'Unauthorized' });

  const userId = String(auth.user.id);

  try {
    const sessionRef = await db.collection('ad_sessions').add({
      userId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ sessionId: sessionRef.id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create ad session' });
  }
};
