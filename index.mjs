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
    
    // 修复：使用正确的URL和端点
    const response = await fetch('https://pandahoho-ai-search-production.up.railway.app/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query }),
    });

    if (!response.ok) {
      console.error(`aiSearchAgent returned status ${response.status}`);
      const errorText = await response.text();
      console.error(`Error details: ${errorText}`);
      return 'Sorry, I had trouble accessing my knowledge base. Please try again in a moment.';
    }

    const data = await response.json();
    console.log('AI Search response:', data);
    
    // 修复：处理正确的响应格式
    if (data.status === 'error') {
      console.error('AI Search error:', data.message);
      return 'Sorry, there was an error processing your search. Please try again.';
    }
    
    if (!data.results || data.results.length === 0) {
      return 'I couldn\'t find any relevant information for your question. Try rephrasing it or asking about something else.';
    }
    
    // 格式化搜索结果为Discord消息
    let response = `🔍 **Search Results for: "${query}"**\n\n`;
    
    data.results.slice(0, 3).forEach((result, index) => {
      const payload = result.payload || {};
      const score = (result.score * 100).toFixed(1);
      
      response += `**${index + 1}. ${payload.title || 'No title'}** (${score}% match)\n`;
      if (payload.description) {
        response += `${payload.description.substring(0, 200)}${payload.description.length > 200 ? '...' : ''}\n`;
      }
      if (payload.url) {
        response += `🔗 ${payload.url}\n`;
      }
      response += '\n';
    });
    
    response += `⏱️ Search completed in ${data.elapsed_ms}ms`;
    
    return response;

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
      // Discord消息有2000字符限制，需要截断
      const truncatedAnswer = answer.length > 2000 ? answer.substring(0, 1997) + '...' : answer;
      
      await fetch(followupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: truncatedAnswer }),
      });
      console.log('Successfully sent response to Discord.');
    } catch (error) {
      console.error('Error sending follow-up message:', error);
      
      // 发送错误回复
      try {
        await fetch(followupUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Sorry, I encountered an error while processing your request.' }),
        });
      } catch (fallbackError) {
        console.error('Error sending fallback message:', fallbackError);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
});