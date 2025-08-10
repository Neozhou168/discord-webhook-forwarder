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

// 手动添加CORS支持（如果没有cors包）
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://www.pandahoho.com',
    'https://pandahoho.com', 
    'https://www.base44.com',
    'https://base44.com',
    'https://base44.app',
    'https://www.base44.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  
  // 处理预检请求
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// 添加JSON解析中间件
app.use(express.json());

// AI搜索服务配置
const AI_SEARCH_URL = process.env.AI_SEARCH_URL || 'https://pandahoho-ai-search-production.up.railway.app';
const REQUEST_TIMEOUT = 20000; // 20秒超时

// Discord配置
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GROUPUP_CHANNEL_ID = process.env.GROUPUP_CHANNEL_ID; // upcoming-group-ups频道ID

// 验证必要的环境变量
if (!DISCORD_BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not found in environment variables');
}

if (!GROUPUP_CHANNEL_ID) {
  console.error('⚠️ GROUPUP_CHANNEL_ID not found - Group-Up notifications will be disabled');
}

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

// 生成Google Maps URL
function generateGoogleMapUrl(payload) {
  try {
    // 优先使用经纬度坐标（最精确）
    if (payload.latitude && payload.longitude) {
      return `https://www.google.com/maps?q=${payload.latitude},${payload.longitude}`;
    }
    
    // 如果有具体地址，使用地址搜索
    if (payload.address) {
      const encodedAddress = encodeURIComponent(payload.address);
      return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    }
    
    // 如果没有地址但有标题，使用标题搜索（适用于知名地点）
    if (payload.title) {
      // 为venues添加"Beijing"确保搜索准确性
      const searchQuery = payload.type === 'venues' 
        ? `${payload.title} Beijing`
        : payload.title;
      const encodedQuery = encodeURIComponent(searchQuery);
      return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
    }
    
    return null; // 无法生成有效的Google Maps URL
    
  } catch (error) {
    console.error('Error generating Google Maps URL:', error);
    return null;
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
          console.log(`Result ${index}: title="${payload.title}", type="${payload.type}", description="${payload.description?.substring(0, 50)}..."`);
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
        
        // 添加链接部分
        if (payload.url) {
          discordMessage += `📍 [View Details](<${payload.url}>)`;
          
          // 如果是venue或route类型，添加Google Maps链接
          if (payload.type === 'venues' || payload.type === 'routes') {
            const googleMapUrl = generateGoogleMapUrl(payload);
            if (googleMapUrl) {
              discordMessage += ` | 🗺️ [View Google Map](<${googleMapUrl}>)`;
            }
          }
          discordMessage += '\n';
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

// 发送Group-Up通知到Discord
async function sendGroupUpNotification(groupUpData) {
  if (!DISCORD_BOT_TOKEN || !GROUPUP_CHANNEL_ID) {
    console.error('❌ Discord Bot Token or Channel ID missing - cannot send Group-Up notification');
    return false;
  }

  try {
    console.log('📢 Sending Group-Up notification to Discord...', groupUpData);

    // 格式化时间
    const startTime = new Date(groupUpData.startTime || groupUpData.start_time);
    const formattedDate = startTime.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const formattedTime = startTime.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    });

    // 获取当前日期用于底部显示
    const currentDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    });

    // 构建按钮组件
    const actionButtons = [];
    
    // View Venue/Route 按钮
    if (groupUpData.venueUrl || groupUpData.routeUrl || groupUpData.detailUrl) {
      const viewUrl = groupUpData.venueUrl || groupUpData.routeUrl || groupUpData.detailUrl;
      const buttonLabel = groupUpData.venueUrl ? 'View Venue' : 
                         groupUpData.routeUrl ? 'View Route' : 'View Details';
      
      actionButtons.push({
        type: 2, // Button type
        style: 5, // Link style (gray)
        label: buttonLabel,
        url: viewUrl
      });
    }

    // Join Group-Up 按钮
    if (groupUpData.joinUrl || groupUpData.groupUpUrl) {
      actionButtons.push({
        type: 2, // Button type
        style: 5, // Link style (gray)
        label: 'Join Group-Up',
        url: groupUpData.joinUrl || groupUpData.groupUpUrl
      });
    }

    // 构建Discord消息 - 匹配截图样式
    const message = {
      embeds: [{
        color: 0x00ff00, // 绿色边框
        title: "🎯 New Group-Up Activity!",
        description: `Join fellow travelers for: **${groupUpData.title || groupUpData.name}**`,
        fields: [
          {
            name: "📅 Start Time",
            value: `${formattedDate} at ${formattedTime}`,
            inline: false
          },
          {
            name: "👤 Organizer", 
            value: groupUpData.organizer || groupUpData.creator || 'Unknown',
            inline: false
          },
          {
            name: "📍 Meeting Point",
            value: groupUpData.meetingPoint || groupUpData.location || 'TBD', 
            inline: false
          },
          {
            name: "📝 Note",
            value: groupUpData.note || groupUpData.description || 'No additional notes',
            inline: false
          }
        ],
        footer: {
          text: currentDate
        },
        timestamp: new Date().toISOString()
      }]
    };

    // 如果有按钮，添加到消息中
    if (actionButtons.length > 0) {
      message.components = [{
        type: 1, // Action Row
        components: actionButtons
      }];
    }

    // 发送消息到Discord频道
    const response = await fetch(`https://discord.com/api/v10/channels/${GROUPUP_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to send Discord notification: ${response.status} ${errorText}`);
      return false;
    }

    console.log('✅ Successfully sent Group-Up notification to Discord');
    return true;

  } catch (error) {
    console.error('❌ Error sending Group-Up notification:', error);
    return false;
  }
}

// Webhook端点：接收Group-Up创建通知
app.post('/webhook/group-up', async (req, res) => {
  try {
    console.log('📥 Received Group-Up webhook:', req.body);

    // 验证请求（可选：添加秘钥验证）
    const groupUpData = req.body;
    
    if (!groupUpData || !groupUpData.title && !groupUpData.name) {
      return res.status(400).json({ 
        error: 'Invalid Group-Up data - missing title/name' 
      });
    }

    // 发送Discord通知
    const success = await sendGroupUpNotification(groupUpData);
    
    if (success) {
      res.json({ 
        status: 'success', 
        message: 'Group-Up notification sent to Discord' 
      });
    } else {
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to send Discord notification' 
      });
    }

  } catch (error) {
    console.error('❌ Error processing Group-Up webhook:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

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

// 测试端点 - 手动测试Group-Up推送
app.get('/test-groupup', async (req, res) => {
  console.log('🧪 Manual test Group-Up notification requested');
  
  // 测试数据 - 包含按钮URL
  const testGroupUpData = {
    title: "San Wu Tang Buffet (三五堂自助)",
    organizer: "neo zhou",
    startTime: "2025-07-31T18:50:00Z",
    meetingPoint: "San Wu Tang Buffet (三五堂自助)",
    note: "eat eat eat",
    venueUrl: "https://www.pandahoho.com/VenueDetail?id=example123", // View Venue 按钮
    joinUrl: "https://www.pandahoho.com/GroupUpDetail?id=example456"  // Join Group-Up 按钮
  };
  
  try {
    const success = await sendGroupUpNotification(testGroupUpData);
    res.json({
      success: success,
      message: success ? 'Test Group-Up notification sent successfully' : 'Failed to send notification',
      testData: testGroupUpData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🧪 Manual test Group-Up failed:', error);
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
    
    const question = interaction.data.options?.[0]?.value;
    if (!question) {
      console.error('❌ No question provided in /ask command');
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '❌ Please provide a question to search!' }
      });
    }

    console.log(`🤔 Processing question: "${question}"`);
    
    // 🔥 立即响应Discord，显示"正在搜索"状态
    res.send({ 
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `🔍 Searching for "${question}", please wait...` }
    });
    
    // 异步处理搜索，然后编辑消息
    setImmediate(async () => {
      try {
        const startTime = Date.now();
        const answer = await getAiResponse(question);
        const processingTime = Date.now() - startTime;
        
        console.log(`✅ AI search completed in ${processingTime}ms, updating Discord message...`);

        // 使用PATCH方法编辑原始消息
        const editUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
        
        // Discord消息长度限制为2000字符
        const truncatedAnswer = answer.length > 2000 ? answer.substring(0, 1997) + '...' : answer;
        
        const editResponse = await fetch(editUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: truncatedAnswer }),
        });

        if (!editResponse.ok) {
          const errorText = await editResponse.text();
          console.error(`❌ Discord message edit failed with status ${editResponse.status}: ${errorText}`);
        } else {
          console.log('✅ Successfully updated Discord message');
        }
        
      } catch (error) {
        console.error('❌ Error in async processing:', error);
        
        // 编辑消息显示错误
        try {
          const editUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
          await fetch(editUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              content: '❌ Search error occurred. Please try again later.' 
            }),
          });
          console.log('📤 Sent error message to Discord user');
        } catch (fallbackError) {
          console.error('❌ Error editing error message:', fallbackError);
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