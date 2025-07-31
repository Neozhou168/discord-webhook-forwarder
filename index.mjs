import express from 'express'
import { verifyKeyMiddleware } from 'discord-interactions'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// 👇 Discord官方推荐验证中间件
app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY),
  (req, res) => {
    return res.send({ type: 1 }) // PONG 回复
  }
)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
