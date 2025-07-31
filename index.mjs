// 强制优先使用 IPv4，避免 UND_ERR_CONNECT_TIMEOUT 错误
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import express from 'express';
import axios from 'axios';
import https from 'https';

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

client.once('ready', () => {
  console.log(`✅ Discord bot "${client.user.tag}" is online.`);
});

// 监听 Slash command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ask') {
    const userQuestion = interaction.options.getString('question');
    try {
      const agent = new https.Agent({ family: 4 }); // 强制使用 IPv4
      const response = await axios.post(
        'https://app.base44.com/api/functions/discordAiBridge',
        {
          question: userQuestion,
          user: interaction.user.username,
          discordId: interaction.user.id,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
          httpsAgent: agent,
        }
      );

      console.log('✅ AI Bridge response:', response.data);

      await interaction.reply({
        content: response.data.reply || '🤖 Got it, but no reply was returned.',
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ AI Bridge error', error.code, error.message);
      await interaction.reply({
        content: '⚠️ Failed to connect to AI bridge.',
        ephemeral: true,
      });
    }
  }
});

// 启动 Express Server (UptimeRobot 保活用)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Discord bot is alive!'));
app.listen(PORT, () => console.log(`🚀 Express server is running on port ${PORT}`));

// 启动 Bot
client.login(process.env.DISCORD_BOT_TOKEN);
