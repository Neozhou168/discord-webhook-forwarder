// index.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/', async (req, res) => {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    const payload = req.body;

    const response = await axios.post(webhookUrl, payload);

    res.status(200).send('Message forwarded to Discord');
  } catch (error) {
    console.error('Error forwarding to Discord:', error.message);
    res.status(500).send('Error forwarding to Discord');
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
