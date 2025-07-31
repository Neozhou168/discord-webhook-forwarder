import 'dotenv/config';
import express from 'express';
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 8080;

// The verifyKeyMiddleware requires the raw request body. 
// Do NOT use express.json() before this middleware.

// The URL for your Base44 bridge function
const BASE44_BRIDGE_URL = process.env.BASE44_BRIDGE_FUNCTION_URL;
// The secret to authenticate with your bridge function
const BRIDGE_SECRET = process.env.RAILWAY_BRIDGE_SECRET;

async function callAiBridge(query) {
  if (!BASE44_BRIDGE_URL || !BRIDGE_SECRET) {
    console.error('Missing BASE44_BRIDGE_FUNCTION_URL or RAILWAY_BRIDGE_SECRET');
    return 'Configuration error: The bot is not connected to the AI brain.';
  }

  try {
    console.log(`Calling bridge at ${BASE44_BRIDGE_URL} with query: "${query}"`);

    const response = await fetch(BASE44_BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_SECRET}`,
      },
      body: JSON.stringify({ query: query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Bridge function returned an error: ${response.status}`, errorText);
      return `Sorry, I had a problem communicating with my brain. (Error: ${response.status})`;
    }

    const data = await response.json();
    return data.answer || 'I received a response, but it was empty.';

  } catch (error) {
    console.error('Error calling AI bridge:', error);
    return 'Sorry, I had a network problem trying to reach my brain.';
  }
}

// Your Discord bot's public key for request verification
const discordPublicKey = process.env.DISCORD_PUBLIC_KEY;
if (!discordPublicKey) {
  console.error('DISCORD_PUBLIC_KEY is not set. Verification will fail.');
  process.exit(1);
}

// Basic health check endpoint
app.get('/', (req, res) => {
  res.send('Panda Hoho Discord Bot is running!');
});

// The main endpoint for Discord interactions
// This middleware verifies the request and parses the body.
app.post('/interactions', verifyKeyMiddleware(discordPublicKey), async function (req, res) {
  const interaction = req.body;

  // Handle PING interactions (required by Discord)
  if (interaction.type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  // Handle slash command interactions
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    if (interaction.data.name === 'ask') {
      
      // Immediately tell Discord "I'm thinking..." to prevent timeout
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });

      // Now, do the slow work in the background
      const question = interaction.data.options[0].value;
      const answer = await callAiBridge(question);
      
      // The URL to send a follow-up message to the original interaction
      const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}`;

      // Send the final answer
      try {
        await fetch(followupUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: answer }),
        });
      } catch (error) {
        console.error('Error sending follow-up message:', error);
      }
      
      return; // End the function
    }
  }
  
  console.log('Unhandled interaction type:', interaction.type);
  return res.status(400).send('Unhandled interaction type.');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
});