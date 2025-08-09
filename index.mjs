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

// 为/interactions路径专门设置原始body中间件
app.use('/interactions', express.raw({ type: 'application/json' }));

// 添加通用JSON中间件（排除/interactions路径）
app.use((req, res, next) => {
  if (req.path !== '/interactions') {
    return express.json({ limit: '10mb' })(req, res, next);
  }
  next();
});

app.use(express.urlencoded({ extended: true }));

// 添加请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.url !== '/health') { // 避免健康检查日志过多
    console.log('Headers:', req.headers);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Body type:', typeof req.body);
      console.log('Body:', req.body);
    }
  }
  next();
});

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
    service: 'Panda Hoho Discord Bot',
    port: PORT,
    env: {
      hasDiscordPublicKey: !!process.env.DISCORD_PUBLIC_KEY,
      hasDiscordAppId: !!process.env.DISCORD_APPLICATION_ID,
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  });
});

// 添加测试AI搜索的端点
app.get('/test-search', async (req, res) => {
  const query = req.query.q || 'test query';
  
  try {
    console.log(`Testing AI search with query: "${query}"`);
    const result = await getAiResponse(query);
    
    res.json({
      success: true,
      query: query,
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test search error:', error);
    res.status(500).json({
      success: false,
      query: query,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 添加测试Discord webhook的端点
app.post('/test-webhook', async (req, res) => {
  const { token, message } = req.body;
  
  if (!token || !message) {
    return res.status(400).json({ error: 'Missing token or message' });
  }
  
  try {
    const webhookUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${token}`;
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    
    const responseText = await response.text();
    
    res.json({
      success: response.ok,
      status: response.status,
      response: responseText,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      interactions: '/interactions',
      testSearch: '/test-search?q=your-query',
      testWebhook: '/test-webhook (POST)'
    }
  });
});

// 简化的ping端点用于测试
app.post('/ping', (req, res) => {
  console.log('Ping received:', req.body);
  res.json({ 
    type: 1, // PONG
    message: 'Pong!',
    timestamp: new Date().toISOString()
  });
});

// 自定义验证中间件替换discord-interactions的verifyKeyMiddleware
function customVerifyKeyMiddleware(publicKey) {
  return async (req, res, next) => {
    try {
      const signature = req.headers['x-signature-ed25519'];
      const timestamp = req.headers['x-signature-timestamp'];
      const body = req.body;

      console.log('=== DISCORD VERIFICATION ===');
      console.log('Signature:', signature);
      console.log('Timestamp:', timestamp);
      console.log('Body type:', typeof body);
      console.log('Body length:', body ? body.length : 'null');

      // 如果没有签名头，可能不是Discord请求
      if (!signature || !timestamp) {
        console.log('Missing signature headers, skipping verification for testing');
        // 暂时跳过验证用于测试
        req.body = JSON.parse(body.toString());
        return next();
      }

      // 使用discord-interactions进行验证
      try {
        const { verifyKey } = await import('discord-interactions');
        const isValidRequest = verifyKey(body, signature, timestamp, publicKey);
        
        if (!isValidRequest) {
          console.error('Invalid request signature');
          return res.status(401).send('Invalid request signature');
        }

        console.log('✅ Discord signature verified');
        req.body = JSON.parse(body.toString());
        next();
      } catch (verifyError) {
        console.error('Verification error:', verifyError);
        // 在开发环境中暂时跳过验证
        if (process.env.NODE_ENV !== 'production') {
          console.log('Skipping verification in development mode');
          req.body = JSON.parse(body.toString());
          return next();
        }
        return res.status(500).send('Verification failed');
      }
    } catch (error) {
      console.error('Custom verify middleware error:', error);
      return res.status(500).send('Internal server error');
    }
  };
}

app.post('/interactions', customVerifyKeyMiddleware(discordPublicKey), async function (req, res) {
  const interaction = req.body;
  
  console.log(`=== INTERACTION RECEIVED ===`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Interaction type: ${interaction.type}`);
  console.log(`Interaction data:`, JSON.stringify(interaction, null, 2));

  try {
    if (interaction.type === InteractionType.PING) {
      console.log('Responding to ping with pong');
      return res.status(200).json({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log(`Command name: ${interaction.data?.name}`);
      
      if (interaction.data?.name === 'ask') {
        // 立即响应Discord（必须在3秒内响应）
        console.log('Sending deferred response to Discord...');
        res.status(200).json({ 
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        });

        const question = interaction.data.options?.[0]?.value;
        
        if (!question) {
          console.error('No question provided in the command');
          
          // 发送错误消息
          setTimeout(async () => {
            try {
              const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
              await fetch(followupUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: 'Error: No question provided.' }),
              });
            } catch (err) {
              console.error('Error sending no-question error:', err);
            }
          }, 100);
          
          return;
        }
        
        console.log(`Processing question: "${question}"`);
        
        // 异步处理搜索请求
        setTimeout(async () => {
          try {
            console.log('=== STARTING AI SEARCH ===');
            const startTime = Date.now();
            
            const answer = await getAiResponse(question);
            const endTime = Date.now();
            
            console.log(`=== AI SEARCH COMPLETED in ${endTime - startTime}ms ===`);
            console.log(`Answer length: ${answer.length} characters`);

            const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
            console.log(`Sending follow-up to: ${followupUrl}`);
            
            // Discord消息有2000字符限制
            const maxLength = 2000;
            const truncatedAnswer = answer.length > maxLength 
              ? answer.substring(0, maxLength - 3) + '...' 
              : answer;
            
            console.log(`Truncated answer length: ${truncatedAnswer.length} characters`);
            
            const followupResponse = await fetch(followupUrl, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Discord-Bot/1.0'
              },
              body: JSON.stringify({ 
                content: truncatedAnswer
              }),
            });

            console.log(`Follow-up response status: ${followupResponse.status}`);

            if (!followupResponse.ok) {
              const errorText = await followupResponse.text();
              console.error(`Follow-up failed: ${errorText}`);
              
              // 尝试发送简化的错误消息
              const errorResponse = await fetch(followupUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  content: `❌ Error occurred while processing your request (Status: ${followupResponse.status})`
                }),
              });
              
              console.log(`Error follow-up status: ${errorResponse.status}`);
            } else {
              console.log('✅ Successfully sent response to Discord');
            }
            
          } catch (error) {
            console.error('=== ERROR IN ASYNC PROCESSING ===');
            console.error('Error details:', error);
            
            // 发送错误回复
            try {
              const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
              
              const errorMessage = error.name === 'AbortError'
                ? '⏱️ Request timed out. Please try again.'
                : '❌ An unexpected error occurred. Please try again.';
                
              const errorResponse = await fetch(followupUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: errorMessage }),
              });
              
              console.log(`Error message sent, status: ${errorResponse.status}`);
            } catch (fallbackError) {
              console.error('Failed to send error message:', fallbackError);
            }
          }
        }, 100); // 100ms延迟确保响应已发送
        
        return; // 确保函数结束
      }
    }
    
    // 处理未知的交互类型或命令
    console.log(`Unknown interaction: type=${interaction.type}, command=${interaction.data?.name}`);
    return res.status(400).json({ error: 'Unknown interaction type or command' });
    
  } catch (error) {
    console.error('=== ERROR IN INTERACTION HANDLER ===');
    console.error('Error details:', error);
    
    // 如果还没有发送响应，发送错误响应
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
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