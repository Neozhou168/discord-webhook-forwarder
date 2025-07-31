import express from 'express';
import { InteractionType, verifyKeyMiddleware } from 'discord-interactions';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

// --- Discord Interactions Handler ---
app.post('/interactions', async (req, res) => {
  const signature = req.header('X-Signature-Ed25519');
  const timestamp = req.header('X-Signature-Timestamp');
  const { verifyKey } = await import('discord-interactions');

  const isValid = verifyKey(req.rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY);

  if (!isValid) {
    return res.status(401).send('Bad request signature');
  }

  const interaction = req.body;

  // Discord handshake: PING -> return PONG
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionType.PONG });
  }

  // Handle /ask command
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'ask') {
    const userPrompt = interaction.data.options?.[0]?.value || 'Ask me anything';
    const question = encodeURIComponent(userPrompt);

    try {
      const bridgeRes = await fetch(`${process.env.BASE44_BRIDGE_FUNCTION_URL}?q=${question}`, {
        headers: {
          'X-Bridge-Token': process.env.RAILWAY_BRIDGE_SECRET
        }
      });

      const result = await bridgeRes.text();

      return res.json({
        type: 4,
        data: {
          content: `🧠 ${result}`
        }
      });
    } catch (error) {
      console.error('Bridge call failed:', error);
      return res.json({
        type: 4,
        data: {
          content: '⚠️ Something went wrong while querying the AI.'
        }
      });
    }
  }

  return res.status(400).send('Unhandled interaction type');
});

// --- GroupUp Webhook Handler ---
app.post('/groupupCreated', async (req, res) => {
  const webhookUrl = process.env.GROUPUP_WEBHOOK_URL;
  const groupup = req.body;

  const payload = {
    content: `📢 **New Group Up Created!**\n\n📍 Location: ${groupup.location}\n🕒 Time: ${groupup.time}\n✏️ Host: ${groupup.host}\n\n[Join Now](${groupup.link})`,
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error sending to Discord webhook:', err);
    res.status(500).send('Failed to send groupup message');
  }
});

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('Hoho Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

