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
    const taskRef = db.collection('tasks').doc(String(taskId));

    let newPoints = 0;
    let alreadyCompleted = false;
    let limitReached = false;
    let customMessage = '';

    // ট্রানজ্যাকশন ব্যবহার করা হলো যাতে ইউজার এবং টাস্ক একসাথে নিরাপদে আপডেট হয়
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data() || {};
      const completedTasks = userData.completedTasks || [];

      // ১. চেক: টাস্কটি আগে থেকেই করা আছে কিনা
      if (completedTasks.includes(taskId)) {
        alreadyCompleted = true;
        newPoints = Number(userData.points ?? userData.balance ?? 0);
        customMessage = 'Task already completed';
        return;
      }

      // ২. চেক: টাস্কটি ডাটাবেজে আছে কিনা এবং Active কিনা
      const taskDoc = await transaction.get(taskRef);
      if (!taskDoc.exists) {
        throw new Error('Task not found');
      }
      const taskData = taskDoc.data() || {};
      if (!taskData.active) {
        throw new Error('Task is no longer active or target impressions reached');
      }

      // ৩. 🌟 ইউজারের লেভেল ও রেফারেল অনুযায়ী দৈনিক লিমিট নির্ধারণ
      const referrals = Number(userData.referralsCount ?? userData.referrals ?? userData.referralCount ?? 0);
      let dailyLimit = 5;
      if (referrals >= 15) dailyLimit = 20;
      else if (referrals >= 10) dailyLimit = 15;
      else if (referrals >= 5) dailyLimit = 10;

      // ৪. 🌟 আজকের তারিখ অনুযায়ী টাস্ক কাউন্ট যাচাই ও দৈনিক লিমিট চেক
      const isSameDay = userData.lastTaskDate === todayUtc;
      const tasksToday = isSameDay ? Number(userData.dailyTasksCompletedToday || userData.tasksCompletedToday || 0) : 0;

      if (tasksToday >= dailyLimit) {
        limitReached = true;
        newPoints = Number(userData.points ?? userData.balance ?? 0);
        customMessage = `Daily limit reached! Max ${dailyLimit} tasks allowed per day.`;
        return; // লিমিট শেষ হলে আর কোনো পয়েন্ট বাড়বে না
      }

      // ৫. ইউজার আপডেট (পয়েন্ট এবং ডেইলি টাস্ক কাউন্ট)
      const currentPts = Number(userData.points ?? userData.balance ?? 0);
      newPoints = currentPts + taskReward;

      transaction.set(userRef, {
        userId,
        name: auth.user.first_name || userData.name || 'User',
        points: admin.firestore.FieldValue.increment(taskReward),
        balance: admin.firestore.FieldValue.increment(taskReward),
        completedTasks: admin.firestore.FieldValue.arrayUnion(taskId),
        dailyTasksCompletedToday: tasksToday + 1,
        tasksCompletedToday: tasksToday + 1,
        lastTaskDate: todayUtc,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // ৬. টাস্ক আপডেট (ভিউ কাউন্ট এবং অটো-হাইড লজিক)
      const targetViews = Number(taskData.targetViews) || 100;
      const currentViews = Number(taskData.currentViews || 0) + 1;

      if (currentViews >= targetViews) {
        // টার্গেট পূরণ হয়ে গেছে! টাস্কটি সবার থেকে স্বয়ংক্রিয়ভাবে হাইড (active: false)
        transaction.set(taskRef, {
          currentViews: currentViews,
          active: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        // টার্গেট এখনো বাকি আছে, ভিউ ১টি বাড়িয়ে রাখা
        transaction.set(taskRef, {
          currentViews: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    // যদি আগে থেকেই করা থাকে
    if (alreadyCompleted) {
      return res.status(200).json({
        success: false,
        alreadyCompleted: true,
        points: newPoints,
        message: customMessage
      });
    }

    // যদি দৈনিক লিমিট শেষ হয়ে থাকে
    if (limitReached) {
      return res.status(400).json({
        success: false,
        limitReached: true,
        points: newPoints,
        error: customMessage
      });
    }

    // সফলভাবে নতুন টাস্ক করলে রেসপন্স
    return res.status(200).json({
      success: true,
      taskId,
      reward: taskReward,
      points: newPoints,
      balance: newPoints,
      message: `Task completed! +${taskReward} PX awarded.`
    });

  } catch (error) {
    console.error('task-complete error:', error);
    return res.status(400).json({ success: false, error: error.message || 'Internal server error' });
  }
};
