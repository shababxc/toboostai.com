// api/task-complete.js
const { db, admin } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

// আজকের আন্তর্জাতিক UTC তারিখ (প্রতিদিন বাংলাদেশ সময় সকাল ৬টায় স্বয়ংক্রিয়ভাবে নতুন দিন শুরু হয়)
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

    // ট্রানজ্যাকশন ব্যবহার করা হলো যাতে ডাটাবেস সম্পূর্ণ হ্যাক-প্রুফ ও সুরক্ষিত থাকে
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data() || {};
      const completedTasks = Array.isArray(userData.completedTasks) ? userData.completedTasks : [];

      // ১. সিকিউরিটি চেক: একই টাস্ক কোনো ইউজার জীবনে দ্বিতীয়বার করতে পারবে না
      if (completedTasks.includes(taskId)) {
        alreadyCompleted = true;
        newPoints = Number(userData.points ?? userData.balance ?? 0);
        customMessage = 'You have already completed this task!';
        return;
      }

      // ২. সিকিউরিটি চেক: টাস্কটি ফায়ারস্টোরে আছে কিনা এবং চালু (Active) আছে কিনা
      const taskDoc = await transaction.get(taskRef);
      if (!taskDoc.exists) {
        throw new Error('Task not found');
      }
      const taskData = taskDoc.data() || {};
      if (!taskData.active) {
        throw new Error('Task is no longer active or target impressions reached');
      }

      // ৩. লেভেল ও রেফারেল অনুযায়ী দৈনিক লিমিট হিসাব (০, ৫, ১০, ২০)
      const referrals = Number(userData.referralsCount ?? userData.referrals ?? userData.referralCount ?? 0);
      let dailyLimit = 5;
      if (referrals >= 20) dailyLimit = 20; // Lv.4 (MAX)
      else if (referrals >= 10) dailyLimit = 15; // Lv.3
      else if (referrals >= 5) dailyLimit = 10;  // Lv.2
      // ৪. 🌟 স্বয়ংসম্পূর্ণ দৈনিক রিসেট লজিক (যা আগের দিনের সংখ্যা কখনোই টানবে না)
      const isSameDay = userData.lastTaskDate === todayUtc;
      let tasksToday = 0;
      
      // শুধুমাত্র যদি আজকেই টাস্ক করে থাকে তবেই আজকের সংখ্যা গুনবে, অন্যথায় সরাসরি ০
      if (isSameDay) {
        tasksToday = Number(userData.dailyTasksCompletedToday ?? userData.tasksCompletedToday ?? 0);
      }

      // যদি ইউজারের আজকের কোটা শেষ হয়ে যায়, সাথে সাথে আটকে দেওয়া হবে
      if (tasksToday >= dailyLimit) {
        limitReached = true;
        newPoints = Number(userData.points ?? userData.balance ?? 0);
        customMessage = `Daily limit reached! Max ${dailyLimit} tasks allowed per day.`;
        return;
      }

      // ৫. ইউজার আপডেট (পয়েন্ট যোগ ও আজকের কাউন্ট +১)
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

      // ৬. টাস্কের ভিউ বাড়ানো এবং ১০,০০০ ভিউজ পূর্ণ হলে অটো-ভেনিশ করা
      const targetViews = Number(taskData.targetViews) || 100;
      const currentViews = Number(taskData.currentViews || 0) + 1;

      if (currentViews >= targetViews) {
        transaction.set(taskRef, {
          currentViews: currentViews,
          active: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        transaction.set(taskRef, {
          currentViews: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    // টাস্ক আগে করা থাকলে
    if (alreadyCompleted) {
      return res.status(200).json({
        success: false,
        alreadyCompleted: true,
        points: newPoints,
        message: customMessage
      });
    }

    // দৈনিক লিমিট শেষ হলে (যা ফ্রন্টএন্ডে সেই সুন্দর মোডাল ওপেন করবে)
    if (limitReached) {
      return res.status(400).json({
        success: false,
        limitReached: true,
        points: newPoints,
        error: customMessage
      });
    }

    // সফলভাবে টাস্ক শেষ হলে
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
