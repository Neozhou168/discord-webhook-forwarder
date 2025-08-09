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

// 添加请求体大小限制和超时处理
app.use(express.json({ limit: '10mb' }));

// --- AI Logic using your working aiSearchAgent function ---
async function getAiResponse(query) {
  try {
    console.log(`Calling aiSearchAgent with query: "${query}"`);
    
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时
    
    const response = await fetch('https://pandahoho-ai-search-production.up.railway.app/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Discord-Bot/1.0'
      },
      body: JSON.stringify({ query: query }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`AI Search response status: ${response.status}`);

    if (!response.ok) {
      console.error(`aiSearchAgent returned status ${response.status}`);
      const errorText = await response.text();
      console.error(`Error details: ${errorText}`);
      return 'Sorry, I had trouble accessing my knowledge base. Please try again in a moment.';
    }

    const data = await response.json();
    console.log('AI Search response data:', JSON.stringify(data, null, 2));
    
    // 处理不同的响应格式
    if (data.status === 'error') {
      console.error('AI Search error:', data.message);
      return `Sorry, there was an error: ${data.message}`;
    }
    
    // 检查结果格式
    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
      console.log('No results found or empty results array');
      return 'I couldn\'t find any relevant information for your question. Try rephrasing it or asking about something else.';
    }
    
    // 格式化搜索结果为Discord消息
    let discordMessage = `🔍 **Search Results for: "${query}"**\n\n`;
    
    const maxResults = Math.min(3, data.results.length);
    
    for (let i = 0; i < maxResults; i++) {
      const result = data.results[i];
      const payload = result.payload || {};
      const score = result.score ? (result.score * 100).toFixed(1) : 'N/A';
      
      discordMessage += `**${i + 1}. ${payload.title || 'No title'}** (${score}% match)\n`;
      
      if (payload.description) {
        const description = payload.description.substring(0, 200);
        discordMessage += `${description}${payload.description.length > 200 ? '...' : ''}\n`;
      }
      
      if (payload.url) {
        discordMessage += `🔗 ${payload.url}\n`;
      }
      
      discordMessage += '\n';
      
      // 检查消息长度，避免超过Discord限制
      if (discordMessage.length > 1500) {
        discordMessage += '...(更多结果已截断)';
        break;
      }
    }
    
    if (data.elapsed_ms) {
      discordMessage += `⏱️ Search completed in ${data.elapsed_ms}ms`;
    }
    
    return discordMessage;

  } catch (error) {
    console.error('Error calling aiSearchAgent:', error);
    
    if (error.name === 'AbortError') {
      return 'Sorry, the search request timed out. Please try again.';
    }
    
    return 'I seem to be having trouble right now. Please try again in a moment.';
  }
}

// 添加健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Panda Hoho Discord Bot'
  });
});

// --- Discord Bot Logic ---
const discordPublicKey = process.env.DISCORD_PUBLIC_KEY?.trim();

if (!discordPublicKey) {
  console.error('DISCORD_PUBLIC_KEY is not set in environment variables');
  process.exit(1);
}

if (!process.env.DISCORD_APPLICATION_ID) {
  console.error('DISCORD_APPLICATION_ID is not set in environment variables');
  process.exit(1);
}

app.get('/', (req, res) => {
  res.json({ 
    message: 'Panda Hoho Discord Bot is running!',
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

app.post('/interactions', verifyKeyMiddleware(discordPublicKey), async function (req, res) {
  const interaction = req.body;
  
  console.log(`Received interaction type: ${interaction.type}`);

  if (interaction.type === InteractionType.PING) {
    console.log('Responding to ping');
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'ask') {
    console.log(`Processing command: ${interaction.data.name}`);
    
    // 立即响应Discord，告诉它我们正在处理（3秒内必须响应）
    res.send({ 
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });

    const question = interaction.data.options?.[0]?.value;
    
    if (!question) {
      console.error('No question provided in the command');
      return;
    }
    
    console.log(`Received question: "${question}"`);
    
    // 异步处理，避免阻塞响应
    setImmediate(async () => {
      try {
        console.log('Starting AI search...');
        const startTime = Date.now();
        
        const answer = await getAiResponse(question);
        const endTime = Date.now();
        
        console.log(`AI search completed in ${endTime - startTime}ms, sending to Discord...`);

        const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
        
        // Discord消息有2000字符限制，需要截断
        const maxLength = 2000;
        const truncatedAnswer = answer.length > maxLength 
          ? answer.substring(0, maxLength - 3) + '...' 
          : answer;
        
        const followupResponse = await fetch(followupUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'Discord-Bot/1.0'
          },
          body: JSON.stringify({ 
            content: truncatedAnswer,
            flags: 0 // 确保消息是公开的
          }),
        });

        if (!followupResponse.ok) {
          const errorText = await followupResponse.text();
          console.error(`Follow-up failed with status ${followupResponse.status}: ${errorText}`);
          
          // 尝试发送简化的错误消息
          const errorFollowup = await fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              content: `Sorry, I encountered an error (Status: ${followupResponse.status}). Please try again.`
            }),
          });
          
          if (!errorFollowup.ok) {
            console.error('Failed to send error follow-up message');
          }
        } else {
          console.log('Successfully sent response to Discord.');
        }
        
      } catch (error) {
        console.error('Error in async processing:', error);
        
        // 发送错误回复
        try {
          const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
          
          const errorMessage = error.message?.includes('fetch') 
            ? 'Sorry, I had trouble connecting to my search service. Please try again.'
            : 'Sorry, I encountered an unexpected error while processing your request.';
            
          await fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: errorMessage }),
          });
        } catch (fallbackError) {
          console.error('Error sending fallback message:', fallbackError);
        }
      }
    });
    
    return; // 确保函数在这里结束
  }
  
  // 处理未知的交互类型
  console.log(`Unknown interaction type: ${interaction.type}`);
  return res.status(400).send({ error: 'Unknown interaction type' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Panda Hoho Discord Bot listening on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});