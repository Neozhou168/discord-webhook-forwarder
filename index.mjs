import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} from 'discord-interactions';

const app = express();
const PORT = process.env.PORT || 3000;

// AI搜索服务配置
const AI_SEARCH_URL = process.env.AI_SEARCH_URL || 'https://pandahoho-ai-search-production.up.railway.app';
const REQUEST_TIMEOUT = 20000; // 20秒超时

// 启动时测试AI服务连接
async function testAiServiceConnection() {
  try {
    console.log('Testing AI search service connection...');
    const response = await fetch(`${AI_SEARCH_URL}/`, { 
      method: 'GET',
      timeout: 5000 
    });
    console.log(`✅ AI service connection test: ${response.status} ${response.statusText}`);
    return response.ok;
  } catch (error) {
    console.error('❌ AI service connection test failed:', error.message);
    return false;
  }
}

// AI搜索响应处理函数
async function getAiResponse(query, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      console.log(`🔍 Calling AI search service with query: "${query}" (attempt ${attempt})`);
      
      // 添加超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(`${AI_SEARCH_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`❌ AI Search service returned status ${response.status}`);
        const errorText = await response.text();
        console.error(`Error details: ${errorText}`);
        
        // 根据状态码返回不同的错误消息
        if (response.status === 502 || response.status === 503) {
          return 'The search service is temporarily unavailable. Please try again later.';
        } else if (response.status === 404) {
          return 'Search endpoint not found. The service may be misconfigured.';
        } else {
          return `Search service error (${response.status}): ${errorText.substring(0, 100)}`;
        }
      }

      const data = await response.json();
      console.log('✅ AI Search response received:', JSON.stringify(data, null, 2));
      console.log('🔍 Raw results count:', data.results?.length || 0);
      
      // 🔥 调试：检查原始结果中是否包含推广信息
      if (data.results) {
        data.results.forEach((result, index) => {
          const payload = result.payload || {};
          console.log(`Result ${index}: title="${payload.title}", description="${payload.description?.substring(0, 50)}..."`);
        });
      }
      
      if (data.status === 'error') {
        console.error('❌ AI Search error:', data.message);
        return `Search error: ${data.message}`;
      }
      
      if (!data.results || data.results.length === 0) {
        return `I couldn't find any relevant information for "${query}". Try rephrasing your question or asking about something else.`;
      }
      
      // 过滤掉推广信息，只保留真实搜索结果
      const realResults = data.results.filter(result => {
        const payload = result.payload || {};
        const description = payload.description || '';
        
        // 只过滤掉包含推广文案的结果
        const isPromo = description.includes('Your guide to the great outdoors');
        if (isPromo) {
          console.log('🚫 Filtered out promotion:', payload.title);
        }
        return !isPromo;
      });
      
      console.log('🔍 Filtered results count:', realResults.length);
      
      if (realResults.length === 0) {
        return `I couldn't find any relevant information for "${query}". Try rephrasing your question or asking about something else.`;
      }
      
      // 格式化搜索结果为Discord消息
      let discordMessage = `🔍 **Search Results for: "${query}"**\n\n`;
      
      realResults.slice(0, 3).forEach((result, index) => {
        const payload = result.payload || {};
        const score = result.score ? (result.score * 100).toFixed(1) : 'N/A';
        
        discordMessage += `**${index + 1}. ${payload.title || 'Untitled'}** (${score}% match)\n`;
        if (payload.description) {
          const desc = payload.description.substring(0, 150);
          discordMessage += `${desc}${payload.description.length > 150 ? '...' : ''}\n`;
        }
        if (payload.url) {
          discordMessage += `📍 [查看详情](<${payload.url}>)\n`;
        }
        discordMessage += '\n';
      });
      
      if (data.elapsed_ms) {
        discordMessage += `⏱️ Search completed in ${data.elapsed_ms}ms`;
      }
      
      return discordMessage;

    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error);
      
      // 如果是最后一次尝试，返回错误消息
      if (attempt === retries + 1) {
        if (error.name === 'AbortError') {
          return 'Search request timed out. The service may be overloaded.';
        } else if (error.code === 'ECONNREFUSED') {
          return 'Cannot connect to search service. It may be down.';
        } else if (error.code === 'ENOTFOUND') {
          return 'Search service URL not found. Please check configuration.';
        } else {
          return `Search service unavailable: ${error.message}`;
        }
      }
      
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Discord验证中间件
const discordPublicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
if (!discordPublicKey) {
  console.error('❌ DISCORD_PUBLIC_KEY not found in environment variables');
  process.exit(1);
}

// 健康检查端点
app.get('/', async (req, res) => {
  console.log('🩺 Health check requested');
  
  // 测试AI搜索服务连接
  let aiServiceStatus = 'unknown';
  try {
    const testResponse = await fetch(`${AI_SEARCH_URL}/`, { 
      timeout: 5000,
      method: 'GET'
    });
    aiServiceStatus = testResponse.ok ? 'connected' : `error_${testResponse.status}`;
  } catch (error) {
    aiServiceStatus = `failed_${error.code || error.name}`;
  }

  const healthInfo = {
    status: 'running',
    service: 'Panda Hoho Discord Bot',
    timestamp: new Date().toISOString(),
    aiSearchUrl: AI_SEARCH_URL,
    aiServiceStatus: aiServiceStatus,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasDiscordPublicKey: !!process.env.DISCORD_PUBLIC_KEY,
      hasDiscordAppId: !!process.env.DISCORD_APPLICATION_ID,
      hasAiSearchUrl: !!process.env.AI_SEARCH_URL,
      port: PORT
    }
  };
  
  console.log('🩺 Health check response:', JSON.stringify(healthInfo, null, 2));
  res.json(healthInfo);
});

// 调试端点 - 手动测试AI搜索
app.get('/test-search', async (req, res) => {
  const testQuery = req.query.q || 'test';
  console.log(`🧪 Manual test search requested: "${testQuery}"`);
  
  try {
    const result = await getAiResponse(testQuery);
    res.json({
      success: true,
      query: testQuery,
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🧪 Manual test search failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Discord交互处理
app.post('/interactions', verifyKeyMiddleware(discordPublicKey), async function (req, res) {
  const interaction = req.body;
  console.log('📨 Received Discord interaction:', interaction.type);

  if (interaction.type === InteractionType.PING) {
    console.log('🏓 Received PING from Discord, responding with PONG');
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'ask') {
    const username = interaction.member?.user?.username || interaction.user?.username || 'unknown';
    console.log(`💬 Received /ask command from user: ${username}`);
    
    // 立即响应Discord，告诉它我们正在处理
    res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

    const question = interaction.data.options?.[0]?.value;
    if (!question) {
      console.error('❌ No question provided in /ask command');
      return;
    }

    console.log(`🤔 Processing question: "${question}"`);
    
    // 异步处理，避免阻塞响应
    setImmediate(async () => {
      try {
        const startTime = Date.now();
        const answer = await getAiResponse(question);
        const processingTime = Date.now() - startTime;
        
        console.log(`✅ AI search completed in ${processingTime}ms, sending to Discord...`);

        const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
        
        // Discord消息长度限制为2000字符
        const truncatedAnswer = answer.length > 2000 ? answer.substring(0, 1997) + '...' : answer;
        
        const followupResponse = await fetch(followupUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: truncatedAnswer }),
        });

        if (!followupResponse.ok) {
          const errorText = await followupResponse.text();
          console.error(`❌ Discord followup failed with status ${followupResponse.status}: ${errorText}`);
        } else {
          console.log('✅ Successfully sent response to Discord');
        }
        
      } catch (error) {
        console.error('❌ Error in async processing:', error);
        
        // 发送错误消息给用户
        try {
          const followupUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}`;
          await fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              content: '❌ Sorry, I encountered an error while processing your request. Please try again later.' 
            }),
          });
          console.log('📤 Sent error message to Discord user');
        } catch (fallbackError) {
          console.error('❌ Error sending fallback message:', fallbackError);
        }
      }
    });
  }
});

// 启动服务器
app.listen(PORT, '0.0.0.0', async () => {
  console.log('🚀 =================================');
  console.log(`🚀 Panda Hoho Discord Bot STARTED`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 AI Search URL: ${AI_SEARCH_URL}`);
  console.log('🚀 =================================');
  
  // 启动时测试AI服务连接
  const aiConnected = await testAiServiceConnection();
  if (aiConnected) {
    console.log('✅ Ready to process Discord commands!');
  } else {
    console.log('⚠️  AI service connection failed, but bot is still running');
  }
}).on('error', (err) => {
  console.error('❌ Failed to start Discord Bot server:', err);
  process.exit(1);
});