// api/admin.js
const { db, admin } = require('./_firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey || (req.body && req.body.adminKey);
    const EXPECTED_KEY = process.env.ADMIN_SECRET_KEY;

    if (!EXPECTED_KEY) {
      console.error('ADMIN_SECRET_KEY is missing in Vercel Environment Variables');
      return res.status(500).json({ success: false, error: 'Server configuration error: ADMIN_SECRET_KEY is not set.' });
    }

    if (!adminKey || adminKey !== EXPECTED_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Secret Key' });
    }

    const { action } = req.query;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // ১. কি ভেরিফিকেশন (Login check)
    if (action === 'verify') {
      return res.status(200).json({ success: true, message: 'Admin authenticated' });
    }

    // ২. ওভারভিউ কাউন্ট (Overview Stats)
    if (action === 'get_overview') {
      const [pendingWithdrawalsSnap, activeTasksSnap] = await Promise.all([
        db.collection('withdrawals').where('status', '==', 'pending').get(),
        db.collection('tasks').where('active', '==', true).get()
      ]);

      return res.status(200).json({
        success: true,
        stats: {
          pendingWithdrawals: pendingWithdrawalsSnap.size,
          activeTasks: activeTasksSnap.size
        }
      });
    }

    // ৩. উইথড্রল রিকোয়েস্ট লিস্ট (Get Withdrawals)
    if (action === 'get_withdrawals') {
      const snapshot = await db.collection('withdrawals').get();
      const withdrawals = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        withdrawals.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()
        });
      });

      // নতুন রিকোয়েস্টগুলো সবার উপরে থাকবে
      withdrawals.sort((a, b) => b.createdAt - a.createdAt);
      return res.status(200).json({ success: true, withdrawals });
    }

    // ৪. উইথড্রল অনুমোদন বা রিজেক্ট (Approve / Reject)
    if (action === 'update_withdrawal' && req.method === 'POST') {
      const { withdrawalId, status, shouldRefund } = body;
      if (!withdrawalId || !status) {
        return res.status(400).json({ success: false, error: 'withdrawalId and status are required' });
      }

      const withdrawRef = db.collection('withdrawals').doc(withdrawalId);
      const withdrawDoc = await withdrawRef.get();
      if (!withdrawDoc.exists) {
        return res.status(404).json({ success: false, error: 'Withdrawal not found' });
      }

      const wData = withdrawDoc.data();
      const userId = String(wData.userId);
      const refundPoints = Number(wData.amountPts) || 0;

      await db.runTransaction(async (transaction) => {
        // উইথড্রল স্ট্যাটাস আপডেট
        transaction.update(withdrawRef, {
          status: status, // 'approved' বা 'rejected'
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // যদি রিজেক্ট করা হয় এবং রিফান্ড এনাবল থাকে, তবে পয়েন্ট ফেরত দেওয়া
        if (status === 'rejected' && shouldRefund && refundPoints > 0) {
          const userRef = db.collection('users').doc(userId);
          transaction.set(userRef, {
            points: admin.firestore.FieldValue.increment(refundPoints),
            withdrawCount: admin.firestore.FieldValue.increment(-1), // টায়ার লিমিট ১ পিছিয়ে দেওয়া
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      });

      return res.status(200).json({ success: true, message: `Withdrawal marked as ${status}` });
    }

    // ৫. টাস্ক বা ক্যাম্পেইন লিস্ট (Get Tasks)
    if (action === 'get_tasks') {
      const snapshot = await db.collection('tasks').get();
      const tasks = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        tasks.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()
        });
      });

      tasks.sort((a, b) => b.createdAt - a.createdAt);
      return res.status(200).json({ success: true, tasks });
    }

    // ৬. টাস্ক একটিভ/পজ টগল (Toggle Task Active)
    if (action === 'toggle_task' && req.method === 'POST') {
      const { taskId, active } = body;
      await db.collection('tasks').doc(taskId).update({
        active: Boolean(active),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(200).json({ success: true, message: `Task ${active ? 'activated' : 'paused'}` });
    }

    // ৭. টাস্ক ডিলিট (Delete Spam Task)
    if (action === 'delete_task' && req.method === 'POST') {
      const { taskId } = body;
      await db.collection('tasks').doc(taskId).delete();
      return res.status(200).json({ success: true, message: 'Task deleted permanently' });
    }

    // ৮. ইউজার লুকআপ (Search User by ID)
    if (action === 'get_user') {
      const targetUserId = String(req.query.userId || '').trim();
      if (!targetUserId) {
        return res.status(400).json({ success: false, error: 'User ID is required' });
      }

      const userDoc = await db.collection('users').doc(targetUserId).get();
      if (!userDoc.exists) {
        return res.status(404).json({ success: false, error: 'User not found in Firestore' });
      }

      return res.status(200).json({ success: true, user: userDoc.data() });
    }

    // ৯. পয়েন্ট বাড়ানো বা কমানো (Adjust Points)
    if (action === 'adjust_points' && req.method === 'POST') {
      const { userId, pointsDelta } = body;
      const delta = parseInt(pointsDelta, 10);
      if (!userId || isNaN(delta)) {
        return res.status(400).json({ success: false, error: 'Valid userId and pointsDelta required' });
      }

      const userRef = db.collection('users').doc(String(userId));
      await userRef.set({
        points: admin.firestore.FieldValue.increment(delta),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const updatedDoc = await userRef.get();
      return res.status(200).json({
        success: true,
        message: `Points updated by ${delta > 0 ? '+' : ''}${delta}`,
        newPoints: updatedDoc.data()?.points || 0
      });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
