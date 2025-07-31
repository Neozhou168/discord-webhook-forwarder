import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from 'discord-interactions';

// --- Base44 SDK Setup with correct import syntax ---
import base44SDK from '@base44/sdk';
const base44 = base44SDK({
  appId: process.env.BASE44_APP_ID,
  apiKey: process.env.BASE44_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 8080;

// --- AI Logic (now inside the bot) ---
async function getAiResponse(query) {
  try {
    console.log("Fetching routes and venues from Base44...");
    const routes = await base44.entities.Route.filter({});
    const venues = await base44.entities.Venue.filter({});
    console.log(`Found ${routes.length} routes and ${venues.length} venues.`);

    const context = `
        AVAILABLE ROUTES:
        ${routes.map(r => `- ${r.title}: Located in ${r.city}. Description: ${r.description}`).join('\n')}

        AVAILABLE VENUES:
        ${venues.map(v => `- ${v.name} (${v.type}): Located in ${v.city}. Description: ${v.description}`).join('\n')}
    `;

    const prompt = `
        You are Panda Hoho, a friendly and helpful travel assistant for China.
        Answer the user's question based ONLY on the context provided below.
        If the answer is not in the context, say "I'm sorry, I can't find specific information on that. You can discover more amazing routes and tips on our website, pandahoho.com!"
        Keep your answers concise and friendly. Always refer users back to pandahoho.com for full guides and details.

        CONTEXT:
        ${context}

        USER QUESTION:
        ${query}
    `;

    console.log("Calling LLM with the prompt...");
    const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
    });
    console.log("LLM response received.");

    return llmResponse;

  } catch (error) {
    console.error('Error in getAiResponse:', error.message);
    return 'I seem to be having trouble accessing my knowledge base right now. Please try again in a moment.';
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