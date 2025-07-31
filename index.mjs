// 解决代理使用 IPv4，避免 UND_ERR_CONNECT_TIMEOUT 错误
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

// 导入依赖
import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import express from 'express';
import axios from 'axios';
import https from 'https';
import bodyParser from 'body-parser';

// 初始化 Discord Bot
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

// 处理 /ask 指令
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.post(
      process.env.BASE44_BRIDGE_FUNCTION_URL,
      {
        prompt: interaction.options.getString('question'),
        userId: interaction.user.id,
        userName: interaction.user.username,
        source: 'discord',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        httpsAgent: agent,
      }
    );

    console.log('✅ AI Bridge response:', response.data);

    await interaction.reply({
      content: response.data.reply || '🧠 Got it, but no reply was returned.',
      ephemeral: true,
    });
  } catch (error) {
    console.error('❌ AI Bridge error', error.code, error.message);
    await interaction.reply({
      content: '⚠️ Failed to connect to AI bridge.',
      ephemeral: true,
    });
  }
});

// 启动 Express 服务
const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());

app.get('/', (_req, res) => res.send('Discord bot is alive!'));

// ✅ 用于 Discord 验证 interactions endpoint（必须返回 200）
app.post('/interactions', (_req, res) => {
  res.status(200).send('OK');
});

// webhook：接收 groupupCreated 并发送到 Discord
app.post('/groupupCreated', async (req, res) => {
  try {
    const webhookUrl = process.env.GROUPUP_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('❌ GROUPUP_WEBHOOK_URL not found');
      return res.status(500).send('Webhook URL not configured');
    }

    const groupup = req.body;

    const content = {
      embeds: [
        {
          title: `📌 New Group-Up: ${groupup.title || 'Untitled'}`,
          description: groupup.description || 'No description provided.',
          fields: [
            { name: '📍 Location', value: groupup.location || 'Unknown', inline: true },
            { name: '⏰ Time', value: groupup.time || 'Not specified', inline: true },
            { name: '👤 Host', value: groupup.creator || 'Anonymous', inline: false },
          ],
          footer: { text: 'Shared via Pandahoho 🤖' },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const webhookRes = await axios.post(webhookUrl, content);
    console.log('✅ Group-up message sent to Discord:', webhookRes.status);
    res.status(200).send('Message sent');
  } catch (error) {
    console.error('❌ Failed to send groupup message to Discord:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Express server is running on port ${PORT}`);
});

// 启动 Bot
client.once('ready', () => {
  console.log(`✅ Discord bot "${client.user.tag}" is online.`);
});
client.login(process.env.DISCORD_BOT_TOKEN);


