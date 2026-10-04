// api/task-complete.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

// আজকের UTC তারিখ বের করার হেল্পার
const getTodayUtc = () => new Date().toISOString().split('T')[0];

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
    const todayUtc = getTodayUtc();

    if (!taskId) {
      return res.status(400).json({ success: false, error: 'Task ID is required' });
    }

    const userRef = db.collection('users').doc(userId);
    const taskRef = db.collection('tasks').doc(taskId);

    let newPoints = 0;
    let alreadyCompleted = false;
    let customMessage = '';

    // ট্রানজ্যাকশন ব্যবহার করা হলো যাতে ইউজার এবং টাস্ক একসাথে নিরাপদে আপডেট হয়
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const userData = userDoc.exists ? userDoc.data() : {};
      const completedTasks = userData.completedTasks || [];

      // ১. চেক: টাস্কটি আগে থেকেই করা আছে কিনা
      if (completedTasks.includes(taskId)) {
        alreadyCompleted = true;
        newPoints = userData.points || 0;
        customMessage = 'Task already completed';
        return; // ট্রানজ্যাকশন এখানেই থেমে যাবে, কোনো ডাটা আপডেট হবে না
      }

      // ২. চেক: টাস্কটি ডাটাবেজে আছে কিনা এবং Active কিনা
      const taskDoc = await transaction.get(taskRef);
      if (!taskDoc.exists) {
        throw new Error('Task not found');
      }
      const taskData = taskDoc.data();
      if (!taskData.active) {
        throw new Error('Task is no longer active');
      }

      // ৩. ইউজার আপডেট (পয়েন্ট এবং ডেইলি টাস্ক কাউন্ট)
      newPoints = (userData.points || 0) + taskReward;
      let currentTasksCount = userData.lastTaskDate === todayUtc ? (userData.dailyTasksCompletedToday || 0) : 0;

      transaction.set(userRef, {
        userId,
        name: auth.user.first_name || userData.name || 'User',
        points: admin.firestore.FieldValue.increment(taskReward),
        completedTasks: admin.firestore.FieldValue.arrayUnion(taskId),
        dailyTasksCompletedToday: currentTasksCount + 1, // আজকের টাস্ক কাউন্ট +১
        lastTaskDate: todayUtc,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // ৪. টাস্ক আপডেট (ভিউ কাউন্ট এবং অটো-হাইড লজিক)
      const targetViews = taskData.targetViews || 100;
      const currentViews = (taskData.currentViews || 0) + 1;

      if (currentViews >= targetViews) {
        // টার্গেট পূরণ হয়ে গেছে! টাস্কটি সবার থেকে হাইড করে দাও (active: false)
        transaction.set(taskRef, {
          currentViews: currentViews,
          active: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        // টার্গেট এখনো বাকি আছে, শুধু ভিউ ১টি বাড়িয়ে রাখো
        transaction.set(taskRef, {
          currentViews: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    // যদি আগে থেকেই করা থাকে, তবে পয়েন্ট না বাড়িয়ে আগের ডাটা রিটার্ন করবে
    if (alreadyCompleted) {
      return res.status(200).json({
        success: false,
        alreadyCompleted: true,
        points: newPoints,
        message: customMessage
      });
    }

    // সফলভাবে নতুন টাস্ক করলে রেসপন্স
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
