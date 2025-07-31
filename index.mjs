// index.mjs

import express from 'express';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Middleware to verify Discord's signature.
 * This is the corrected implementation.
 */
const verifyDiscordSignature = (req, res, buf) => {
  const signature = req.get('x-signature-ed25519');
  const timestamp = req.get('x-signature-timestamp');
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) {
    throw new Error('Missing Discord signature headers or public key');
  }

  const isVerified = nacl.sign.detached.verify(
    Buffer.concat([Buffer.from(timestamp), buf]), // The message is timestamp + raw body
    Buffer.from(signature, 'hex'),                 // The signature from the header
    Buffer.from(publicKey, 'hex')                  // Your public key from env
  );

  if (!isVerified) {
    res.status(401).send('Invalid request signature'); // Send response and stop
    throw new Error('Invalid request signature'); // Also throw to halt execution
  }
};


/**
 * Route for handling all Discord interactions
 */
app.post('/interactions', express.json({ verify: verifyDiscordSignature }), async (req, res) => {
  const interaction = req.body;

  // Handle Discord's verification PING
  if (interaction.type === 1) { // PING
    console.log('Responding to Discord PING');
    return res.send({ type: 1 }); // PONG
  }

  // Handle slash commands
  if (interaction.type === 2) { // APPLICATION_COMMAND
    const { name, options } = interaction.data;

    if (name === 'ask') {
      const question = options[0].value;
      console.log(`Received /ask command: "${question}"`);

      // Defer the response immediately to avoid the 3-second timeout
      res.send({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

      try {
        const bridgeUrl = process.env.BASE44_BRIDGE_FUNCTION_URL;
        const bridgeSecret = process.env.RAILWAY_BRIDGE_SECRET;

        if (!bridgeUrl || !bridgeSecret) {
          throw new Error('Bridge URL or Secret not configured on Railway');
        }

        console.log('Calling Base44 AI bridge function...');
        const aiResponse = await axios.post(
          bridgeUrl,
          { query: question },
          {
            headers: {
              'Authorization': `Bearer ${bridgeSecret}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000 // Increase timeout to 15 seconds for AI
          }
        );

        const answer = aiResponse.data.answer || "I'm sorry, I couldn't find an answer to that.";
        
        // Send the follow-up response with the AI's answer
        await axios.patch(
          `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
          { content: answer }
        );

        console.log('Successfully sent AI response to Discord');

      } catch (error) {
        console.error('Error processing /ask command:', error.response ? error.response.data : error.message);
        
        try {
          await axios.patch(
            `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
            { content: `Sorry, a technical problem occurred while I was thinking. The team has been notified!` }
          );
        } catch (followUpError) {
          console.error('Failed to send error follow-up:', followUpError.message);
        }
      }
      return;
    }
  }

  console.warn('Unhandled interaction type:', interaction.type);
  return res.status(400).send({ error: 'unhandled interaction type' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('Panda Hoho Discord Bot is running! 🐼');
});


app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
});