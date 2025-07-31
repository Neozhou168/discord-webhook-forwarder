import express from 'express';
import nacl from 'tweetnacl';
import { json } from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/interactions', (req, res) => {
  const signature = req.header('X-Signature-Ed25519');
  const timestamp = req.header('X-Signature-Timestamp');
  const rawBody = req.rawBody;

  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody.toString()),
    Buffer.from(signature, 'hex'),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    return res.status(401).send('Bad request signature');
  }

  const interactionType = req.body.type;
  if (interactionType === 1) {
    return res.json({ type: 1 }); // PING
  }

  return res.sendStatus(400);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

