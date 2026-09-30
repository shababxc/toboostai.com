// api/task-complete.js
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
    const taskId = req.body && req.body.taskId;
    const taskReward = Number((req.body && req.body.reward) || 200);

    if (!taskId) {
      return res.status(400).json({ success: false, error: 'Task ID is required' });
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // টাস্কটি আগে থেকেই করা আছে কিনা চেক
    const completedTasks = userData.completedTasks || [];
    if (completedTasks.includes(taskId)) {
      return res.status(200).json({
        success: false,
        alreadyCompleted: true,
        points: userData.points || 0,
        message: 'Task already completed'
      });
    }

    const newPoints = (userData.points || 0) + taskReward;

    // ফায়ারবেসে +২০০ পয়েন্ট এবং টাস্কটি সেভ করা
    await userRef.set({
      userId,
      name: auth.user.first_name || userData.name || 'User',
      points: admin.firestore.FieldValue.increment(taskReward),
      completedTasks: admin.firestore.FieldValue.arrayUnion(taskId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({
      success: true,
      taskId,
      reward: taskReward,
      points: newPoints,
      message: `Task completed! +${taskReward} PTS awarded.`
    });
  } catch (error) {
    console.error('task-complete error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
