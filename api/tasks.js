// api/tasks.js
const { admin, db } = require('./_firebase');
const { verifyTelegramWebAppData } = require('./_telegram');

// ডাটাবেজ খালি থাকলে দেখানোর জন্য ডিফল্ট টাস্ক
const DEFAULT_TASKS = [
  {
    id: 'tg_channel_join',
    title: 'Join Official Channel',
    url: 'https://t.me/ToFarmsAi_Bot',
    reward: 200,
    category: 'Telegram',
    active: true
  },
  {
    id: 'tg_group_join',
    title: 'Join Community Group',
    url: 'https://t.me/ToFarmsAi_Bot',
    reward: 200,
    category: 'Telegram',
    active: true
  },
  {
    id: 'x_follow',
    title: 'Follow Official X (Twitter)',
    url: 'https://x.com',
    reward: 200,
    category: 'Twitter',
    active: true
  }
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-init-data');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ১. GET: ডাটাবেজ থেকে সব লাইভ ও একটিভ টাস্ক লোড করা
  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('tasks')
        .where('active', '==', true)
        .get();

      if (snapshot.empty) {
        return res.status(200).json({ tasks: DEFAULT_TASKS });
      }

      const tasks = [];
      snapshot.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() });
      });

      return res.status(200).json({ tasks });
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return res.status(200).json({ tasks: DEFAULT_TASKS });
    }
  }

  // ২. POST: পোস্ট ট্যাব থেকে নতুন টাস্ক সাবমিট করলে ফায়ারবেসে সেভ করা
  if (req.method === 'POST') {
    try {
      const initData = req.headers['x-telegram-init-data'];
      const verified = verifyTelegramWebAppData(initData);
      if (!verified || !verified.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { title, url, reward, category } = req.body || {};

      if (!title || !url) {
        return res.status(400).json({ error: 'Title and URL are required' });
      }

      const taskData = {
        title: String(title).trim(),
        url: String(url).trim(),
        reward: Number(reward) || 200,
        category: category || 'Telegram',
        active: true,
        createdBy: String(verified.user.id),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const docRef = await db.collection('tasks').add(taskData);

      return res.status(200).json({
        success: true,
        task: {
          id: docRef.id,
          ...taskData
        }
      });
    } catch (error) {
      console.error('Error creating task:', error);
      return res.status(500).json({ error: 'Failed to create task' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
