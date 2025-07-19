const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// ✅ 健康检查端点
app.get('/test', (req, res) => {
  res.status(200).send('✅ Webhook forwarder is running.');
});

// ✅ Discord Webhook 转发逻辑
app.get('/test', (req, res) => {
  res.send('✅ Webhook server is running!');
});

app.post('/', async (req, res) => {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
      console.error('❌ DISCORD_WEBHOOK_URL is not defined.');
      return res.status(500).send('Webhook URL not configured.');
    }

    const payload = req.body;

    console.log('📥 Received payload:', JSON.stringify(payload, null, 2));
    console.log('📤 Forwarding to Discord Webhook:', webhookUrl);

    const response = await axios.post(webhookUrl, payload);

    console.log('✅ Discord response status:', response.status);
    res.status(200).send('✅ Message forwarded to Discord.');
  } catch (error) {
    console.error('❌ Error forwarding to Discord:', error.response?.data || error.message);
    res.status(500).send('❌ Failed to forward to Discord.');
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
});

