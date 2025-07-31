// 修复 DNS 问题（可选）
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

// 基础依赖
import express from 'express';
import axios from 'axios';
import https from 'https';
import bodyParser from 'body-parser';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import 'dotenv/config';

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

// Express 服务器
const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());

// ✅ Discord 验证 interactions endpoint 使用的接口
app.post('/interactions', (req, res) => {
  if (req.body && req.body.type === 1) {
    return res.status(200).json({ type: 1 }); // Respond to Discord verification ping
  }

  // 如有更多 interaction 类型可在这里处理
  return res.status(400).send('Unhandled interaction type');
});

// ✅ GroupUp 消息 Webhook 推送接口
app.post('/groupupCreated', async (req, res) => {
  try {
    const webhookUrl = process.env.GROUPUP_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('❌ GROUPUP_WEBHOOK_URL not configured');
      return res.status(500).send('Webhook URL not found');
    }

    const groupup = req.body;

    const content = {
      embeds: [
        {
          title: `✨ New Group-Up: ${groupup.title || 'Untitled'}`,
          description: groupup.description || 'No description provided.',
          fields: [
            { name: '📍 Location', value: groupup.location || 'Unknown', inline: true },
            { name: '⏰ Time', value: groupup.time || 'Not specified', inline: true },
            { name: '👤 Host', value: groupup.creator || 'Anonymous', inline: false },
          ],
          footer: { text: 'Shared via Pandahoho 🐼' },
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

// ✅ 启动 Express 服务器
app.listen(PORT, () => {
  console.log(`✅ Express server is running on port ${PORT}`);
});

// ✅ /ask 指令处理逻辑
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName !== 'ask') return;

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

    console.log('🧠 AI Bridge response:', response.data);

    await interaction.reply({
      content: response.data.reply || '💬 Got it, but no reply was returned.',
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

// ✅ 登录 Discord
client.once('ready', () => {
  console.log(`✅ Discord bot "${client.user.tag}" is online.`);
});
client.login(process.env.DISCORD_BOT_TOKEN);

