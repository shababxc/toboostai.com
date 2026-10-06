// api/tasks.js
const { admin, db } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

const RECEIVER_ADDRESS = 'UQC_uwp-fGIO5qwRgGKe0ymORn-Cd-pW_HtBVbHD-NPzIVfq';

const DEFAULT_TASKS = [
  {
    id: 'tg_channel_join',
    title: 'Subscribe to @ToBOOST_Ai Channel',
    url: 'https://t.me/ToBOOST_Ai',
    reward: 200,
    category: 'Social',
    iconType: 'telegram',
    actionText: 'Start',
    active: true
  },
  {
    id: 'x_follow',
    title: 'Follow ToBOOSTAi on X / Twitter',
    url: 'https://x.com/toboostapp',
    reward: 200,
    category: 'Social',
    iconType: 'twitter',
    actionText: 'Start',
    active: true
  },
  {
    id: 'partner_station',
    title: 'Join Partner Community',
    url: 'https://t.me/ToBOOST_Ai',
    reward: 200,
    category: 'Partners',
    iconType: 'telegram',
    actionText: 'Start',
    active: true
  },
  {
    id: 'web3_showcase',
    title: 'Visit Web3 Showcase',
    url: 'https://t.me/ToBOOST_Ai',
    reward: 200,
    category: 'Web3',
    iconType: 'bot',
    actionText: 'Start',
    active: true
  }
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-init-data');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ১. GET রিকোয়েস্ট: পেমেন্ট অ্যাড্রেস অথবা টাস্ক লিস্ট পাঠানো
  if (req.method === 'GET') {
    const { action } = req.query;

    if (action === 'payment_info') {
      return res.status(200).json({
        receiverAddress: RECEIVER_ADDRESS,
        network: 'TON',
        token: 'GRAM',
        memoRequired: false
      });
    }

    try {
      const snapshot = await db.collection('tasks').where('active', '==', true).get();
      if (snapshot.empty) {
        return res.status(200).json({ tasks: DEFAULT_TASKS });
      }
      
      const tasks = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        tasks.push({
          id: doc.id,
          ...data,
          actionText: 'Start',
          _time: data.createdAt ? (data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now()) : 0
        });
      });

      tasks.sort((a, b) => b._time - a._time);
      return res.status(200).json({ tasks });
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return res.status(200).json({ tasks: DEFAULT_TASKS });
    }
  }

  // ২. POST রিকোয়েস্ট: ক্লায়েন্ট নতুন টাস্ক পোস্ট করলে ডাটাবেস থেকে পয়েন্ট কাটা ও সেভ করা
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const initData = req.headers['x-telegram-init-data'] || body.initData || '';
      const verified = verifyTelegramWebAppData(initData);
      if (!verified || !verified.user) {
        return res.status(401).json({ error: 'Unauthorized Telegram user' });
      }

      const userId = String(verified.user.id);
      const userRef = db.collection('users').doc(userId);

      const { title, url, reward, category, iconType, impressions, cost, paidWith } = body;
      
      if (!title || !url) {
        return res.status(400).json({ error: 'Title and URL are required' });
      }

      const taskCost = Number(cost) || 0;
      const paymentMethod = String(paidWith || 'PTS');

      // 🔥 PTS দিয়ে পোস্ট করলে ফায়ারস্টোর থেকে সরাসরি পয়েন্ট পার্মানেন্টলি কেটে নেওয়া
      if (paymentMethod === 'PTS' && taskCost > 0) {
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const currentPoints = userSnap.data().points || 0;
          if (currentPoints < taskCost) {
            return res.status(400).json({ error: `Insufficient PTS balance! You need ${taskCost} PTS.` });
          }
        }

        // ডাটাবেস থেকে পয়েন্ট মাইনাস
        await userRef.set({
          userId: userId,
          points: admin.firestore.FieldValue.increment(-taskCost),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      let safeIcon = iconType;
      if (!safeIcon) {
        if (url.includes('t.me')) safeIcon = 'telegram';
        else if (url.includes('x.com') || url.includes('twitter.com')) safeIcon = 'twitter';
        else if (url.includes('youtube.com') || url.includes('youtu.be')) safeIcon = 'youtube';
        else if (url.includes('facebook.com')) safeIcon = 'facebook';
        else if (url.includes('instagram.com')) safeIcon = 'instagram';
        else safeIcon = 'others';
      }

      const taskData = {
        title: String(title).trim(),
        url: String(url).trim(),
        reward: Number(reward) || 200,
        category: category || 'Social',
        iconType: safeIcon,
        actionText: 'Start',                     // সবসময় 'Start' হিসেবে সেভ হবে
        active: true,
        targetViews: Number(impressions) || 100, // সঠিক ইমপ্রেশন সংখ্যা (যেমন: ১০,০০০)
        currentViews: 0,
        cost: taskCost,
        paidWith: paymentMethod,
        createdBy: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const docRef = await db.collection('tasks').add(taskData);
      return res.status(200).json({ success: true, task: { id: docRef.id, ...taskData } });
    } catch (error) {
      console.error('Error creating task:', error);
      return res.status(500).json({ error: 'Failed to create task' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
