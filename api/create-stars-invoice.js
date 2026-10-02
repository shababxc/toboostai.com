// api/create-stars-invoice.js

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-init-data');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { title, starsCost, impressions } = body || {};

    const BOT_TOKEN = process.env.BOT_TOKEN;

    if (!BOT_TOKEN) {
      console.error('Missing BOT_TOKEN in Environment Variables');
      return res.status(500).json({ error: 'Server configuration error: BOT_TOKEN is missing' });
    }

    const amount = parseInt(starsCost, 10);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid Stars cost' });
    }

    // Telegram Payload Limit: সর্বোচ্চ ১২৮ বাইট হতে পারে
    // তাই পেলোডকে সংক্ষেপিত এবং নিরাপদ ফরম্যাটে রাখা হলো
    const safePayload = `task_${Date.now()}_${amount}`;

    // Telegram Stars API Call (XTR কারেন্সিতে provider_token দরকার হয় না)
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: (title || 'Bounty Task').slice(0, 30), // Title max 32 chars
        description: `Promote task for ${impressions || 100} views on ToBOOSTAi`, // Desc max 255 chars
        payload: safePayload, // Safe under 128 bytes
        currency: 'XTR',      // XTR = Official Telegram Stars ISO
        prices: [
          {
            label: `${impressions || 100} Views Campaign`,
            amount: amount    // 1 Star = 1 Unit
          }
        ]
      })
    });

    const data = await response.json();

    if (data.ok && data.result) {
      // টেলিগ্রাম থেকে পাওয়া আসল ইনভয়েস লিংক
      return res.status(200).json({ success: true, invoiceLink: data.result });
    } else {
      console.error('Telegram Stars Invoice Error:', data);
      return res.status(400).json({
        error: data.description || 'Could not generate Stars invoice from Telegram'
      });
    }
  } catch (error) {
    console.error('Server error creating invoice:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
