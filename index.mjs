// index.mjs

import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';
config();

import { Client, GatewayIntentBits, ActivityType, EmbedBuilder } from 'discord.js';
import { verifyKeyMiddleware, InteractionType } from 'discord-interactions';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  presence: {
    status: 'online',
    activities: [
      {
        name: 'for group-up activities',
        type: ActivityType.Watching,
      },
    ],
  },
});

client.once('ready', () => {
  console.log(`✅ Discord bot "${client.user.tag}" is online.`);
});

client.login(process.env.DISCORD_BOT_TOKEN);

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 1️⃣ Discord interactions endpoint: 验证及处理指令
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async (req, res) => {
  const interaction = req.body;

  if (interaction.type === InteractionType.PING) {
    return res.send({ type: 1 });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const query = interaction.data.options?.find(o => o.name === 'query')?.value;

    if (!query) {
      return res.send({
        type: 4,
        data: {
          content: '⚠️ Please provide a query.',
        },
      });
    }

    try {
      const response = await axios.post(process.env.AI_BRIDGE_URL, { prompt: query }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        httpsAgent: new https.Agent({ keepAlive: true }),
      });

      return res.send({
        type: 4,
        data: {
          content: response.data.reply || '🤖 Got it, but no reply was returned.',
        },
      });
    } catch (err) {
      console.error('AI Bridge Error:', err.message);
      return res.send({
        type: 4,
        data: {
          content: '⚠️ Failed to connect to AI bridge.',
        },
      });
    }
  }
});

// 2️⃣ GroupUp webhook handler
app.post('/groupupCreated', async (req, res) => {
  const data = req.body;

  if (!data || !data.title || !data.description) {
    return res.status(400).send('Missing fields in webhook payload.');
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle(`📌 ${data.title}`)
      .setDescription(data.description)
      .setColor(0x00AE86)
      .setTimestamp(new Date());

    await axios.post(process.env.GROUPUP_WEBHOOK_URL, {
      embeds: [embed],
    });

    console.log('✅ GroupUp pushed to Discord.');
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Failed to push GroupUp to Discord:', err.message);
    res.status(500).send('Failed to push GroupUp.');
  }
});

// 3️⃣ Home page endpoint
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Hoho bot is alive!'));
app.listen(PORT, () => {
  console.log(`🚀 Express server is running on port ${PORT}`);
});


