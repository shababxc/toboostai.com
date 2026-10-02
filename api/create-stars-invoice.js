// api/create-stars-invoice.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title, starsCost, impressions, actionUrl } = req.body;

    // আপনার টেলিগ্রাম বটের টোকেন দিন (BotFather থেকে পাওয়া)
    // এটি Environment Variable (process.env.BOT_TOKEN) হিসেবে রাখাই সবচেয়ে নিরাপদ
    const BOT_TOKEN = process.env.BOT_TOKEN || 'আপনার_বট_টোকেন_এখানে_দিন';

    if (!starsCost || starsCost <= 0) {
      return res.status(400).json({ error: 'Invalid Stars cost' });
    }

    const payload = JSON.stringify({
      taskTitle: title,
      stars: starsCost,
      impressions: impressions,
      url: actionUrl,
      timestamp: Date.now()
    });

    // টেলিগ্রাম বট API-এর createInvoiceLink মেথড কল করা
    // টেলিগ্রাম স্টারসের অফিসিয়াল কারেন্সি কোড হলো "XTR"
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Promote: ${title.slice(0, 30)}`,
        description: `Bounty Campaign for ${impressions} Views on ToBOOSTAi`,
        payload: payload,
        currency: 'XTR', // XTR = Telegram Stars
        prices: [
          {
            label: `${impressions} Views Campaign`,
            amount: parseInt(starsCost, 10) // স্টারসের পরিমাণ
          }
        ]
      })
    });

    const data = await response.json();

    if (data.ok && data.result) {
      // সফলভাবে তৈরি হওয়া ইনভয়েস লিংক ফ্রন্টএন্ডে পাঠানো
      return res.status(200).json({ success: true, invoiceLink: data.result });
    } else {
      console.error('Telegram Stars Invoice Error:', data);
      return res.status(400).json({
        error: data.description || 'Could not generate Stars invoice'
      });
    }
  } catch (error) {
    console.error('Server error creating invoice:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
