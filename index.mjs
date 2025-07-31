import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from 'discord-interactions';

const app = express();
const PORT = process.env.PORT || 8080;

// --- AI Logic using your working aiSearchAgent function ---
async function getAiResponse(query) {
  try {
    console.log(`Calling aiSearchAgent with query: "${query}"`);
    
    const response = await fetch('https://pandahoho.base44.app/functions/aiSearchAgent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query }),
    });

    if (!response.ok) {
      console.error(`aiSearchAgent returned status ${response.status}`);
      return 'Sorry, I had trouble accessing my knowledge base. Please try again in a moment.';
    }

    const data = await response.json();
    return data.response || data || 'I received a response, but it was empty.';

  } catch (error) {
    console.error('Error calling aiSearchAgent:', error);
    return 'I seem to be having trouble right now. Please try again in a moment.';
  }
}

// --- Discord Bot Logic ---
const discordPublicKey = process.env.DISCORD_PUBLIC_KEY.trim();

app.get('/', (req, res) => res.send('Panda Hoho Discord Bot is running!'));

app.post('/interactions', verifyKeyMiddleware(discordPublicKey), async function (req, res) {
  const interaction = req.body;

  if (interaction.type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'ask') {
    res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

    const question = interaction.data.options[0].value;
    console.log(`Received question: "${question}"`);
    const answer = await getAiResponse(question);

    const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}`;

    try {
      await fetch(followupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: answer }),
      });
      console.log('Successfully sent response to Discord.');
    } catch (error) {
      console.error('Error sending follow-up message:', error);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
});