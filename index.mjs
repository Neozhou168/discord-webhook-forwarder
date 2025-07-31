// index.mjs
import express from 'express';
import { json } from 'body-parser';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Step 1: capture rawBody for signature verification
app.use(json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Step 2: main /interactions handler
app.post('/interactions', (req, res) => {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.rawBody;

  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody.toString()),
    Buffer.from(signature, 'hex'),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    console.log('Signature verification failed');
    return res.status(401).send('invalid request signature');
  }

  const { type } = req.body;

  if (type === 1) {
    // Ping
    return res.send({ type: 1 });
  }

  // 可选：后续添加更多交互类型
  return res.status(400).send('Unhandled interaction type');
});

// Step 3: start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
