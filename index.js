const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// Replace this with your Discord Webhook URL
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

app.post("/groupup", async (req, res) => {
  const { routeTitle, startTime, organizerName, note, participants = [] } = req.body;

  const message = {
    embeds: [
      {
        title: "🚴 Group–Up Event Started!",
        color: 0x00BFFF,
        fields: [
          { name: "📍 Route", value: routeTitle, inline: false },
          { name: "🕐 Start Time", value: startTime, inline: true },
          { name: "👤 Organizer", value: organizerName, inline: true },
          { name: "📝 Note", value: note || "No note provided", inline: false },
          {
            name: "🧑‍🤝‍🧑 Participants",
            value: participants.length > 0 ? participants.join(", ") : "None yet"
          }
        ]
      }
    ]
  };
  

  try {
    await axios.post(DISCORD_WEBHOOK_URL, message);
    res.status(200).send("Webhook sent to Discord!");
  } catch (error) {
    console.error("Error sending to Discord:", error.message);
    res.status(500).send("Failed to send webhook to Discord.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));