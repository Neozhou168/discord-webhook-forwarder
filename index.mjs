// index.mjs

import express from 'express';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// This middleware captures the raw body correctly for verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));


/**
 * Route for handling all Discord interactions
 */
app.post('/interactions', async (req, res) => {
  const signature = req.get('x-signature-ed25519');
  const timestamp = req.get('x-signature-timestamp');
  const rawBody = req.rawBody; // Get the raw body from the middleware

  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody.toString('utf-8')), // Correctly combine timestamp and body
    Buffer.from(signature, 'hex'),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    console.log('Signature verification failed');
    return res.status(401).send('invalid request signature');
  }
  
  const interaction = req.body;

  // Handle Discord's verification PING
  if (interaction.type === 1) { // PING
    console.log('Responding to Discord PING');
    return res.json({ type: 1 }); // PONG
  }

  // Handle slash commands
  if (interaction.type === 2 && interaction.data.name === 'ask') {
    const question = interaction.data.options[0].value;
    console.log(`Received /ask command: "${question}"`);

    // Defer the response immediately to avoid the 3-second timeout
    res.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

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
          timeout: 15000 // 15 second timeout for the AI function
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