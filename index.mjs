// index.mjs

import express from 'express';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();

// Capture rawBody for signature validation
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

/**
 * Discord signature verification middleware
 */
const verifyDiscordSignature = (req, res, next) => {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.rawBody;

  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody.toString()),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    console.log('Signature verification failed');
    return res.status(401).send('invalid request signature');
  }

  next();
};

/**
 * Handle Discord interactions (slash commands, buttons, etc.)
 */
app.post('/interactions', verifyDiscordSignature, async (req, res) => {
  const { type, data, token, application_id } = req.body;

  // Handle Discord ping
  if (type === 1) {
    return res.send({ type: 1 });
  }

  // Handle application commands
  if (type === 2) {
    const { name, options } = data;

    if (name === 'ask') {
      // Acknowledge the command immediately
      res.send({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

      const question = options[0].value;
      console.log(`Received /ask command with question: "${question}"`);

      // Call Base44 AI function
      try {
        const bridgeUrl = process.env.BASE44_BRIDGE_FUNCTION_URL;
        const bridgeSecret = process.env.RAILWAY_BRIDGE_SECRET;

        if (!bridgeUrl || !bridgeSecret) {
          throw new Error('Bridge URL or Secret not configured');
        }

        console.log('Calling Base44 AI bridge function...');
        const aiResponse = await axios.post(
          bridgeUrl,
          { query: question },
          {
            headers: {
              'Authorization': `Bearer ${bridgeSecret}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const answer = aiResponse.data.answer || "I couldn't find an answer to that.";

        // Send follow-up response
        await axios.patch(
          `https://discord.com/api/v10/webhooks/${application_id}/${token}/messages/@original`,
          {
            content: `> **You asked:** ${question}\n\n${answer}`
          },
          {
            headers: {
              'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Successfully sent AI response to Discord');

      } catch (error) {
        console.error('Error processing /ask command:', error.message);
        
        // Send error response
        try {
          await axios.patch(
            `https://discord.com/api/v10/webhooks/${application_id}/${token}/messages/@original`,
            {
              content: `> **You asked:** ${question}\n\nSorry, I ran into an error trying to answer that. Please try again later.`
            },
            {
              headers: {
                'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (followUpError) {
          console.error('Failed to send error response:', followUpError.message);
        }
      }

      return; // Response already sent
    }
  }

  // Default response for unhandled interactions
  return res.sendStatus(400);
});

/**
 * Handle Group-Up announcements from Base44
 */
app.post('/groupup-announcement', async (req, res) => {
  const { title, url, creator, time, location } = req.body;
  
  console.log('Received group-up announcement:', title);

  const webhookUrl = process.env.GROUPUP_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('GROUPUP_WEBHOOK_URL is not set');
    return res.status(500).send('Webhook URL not configured');
  }

  // Create Discord embed for the announcement
  const embed = {
    title: `🎉 New Group-Up: ${title}`,
    url: url,
    color: 0x5865F2, // Discord blurple
    fields: [
      { name: 'Organizer', value: creator, inline: true },
      { name: 'Time', value: time, inline: true },
      { name: 'Location', value: location, inline: false }
    ],
    footer: {
      text: 'Want to join? Click the title to see details!'
    },
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(webhookUrl, {
      content: 'A new adventure is brewing! @here',
      embeds: [embed]
    });

    console.log('Successfully sent group-up announcement to Discord');
    return res.status(200).send('Announcement sent successfully');

  } catch (error) {
    console.error('Error sending group-up announcement:', error.message);
    return res.status(500).send('Failed to send announcement');
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).send({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      interactions: '/interactions',
      groupup: '/groupup-announcement'
    }
  });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.send('Panda Hoho Discord Bot is running! 🐼');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});