const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

module.exports = async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const auth = verifyTelegramWebAppData(initData);

  if (!auth || !auth.user) {
    return res.status(401).json({ error: 'Unauthorized Telegram session' });
  }

  const userId = String(auth.user.id);
  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();

  if (!doc.exists) {
    const newUser = {
      userId,
      name: auth.user.first_name || 'User',
      points: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await userRef.set(newUser);
    return res.status(200).json(newUser);
  }

  return res.status(200).json(doc.data());
};
