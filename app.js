const DEFAULT_GPT_PATH =
  "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt";
const DEFAULT_SOVITS_PATH =
  "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth";
const DEFAULT_PROMPT_PATH = "GPT_SoVITS/pretrained_models/default_prompt.wav";
const DEFAULT_PROMPT_TEXT = "그는 괜찮은 척하려고 애쓰는 것 같았다.";
const DEFAULT_PROMPT_LANGUAGE = "all_ko";

require("dotenv").config();

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  StreamType,
} = require("@discordjs/voice");
const axios = require("axios");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

if (!process.env.DISCORD_TOKEN || !process.env.USER_DB_RELATIVE_PATH) {
  console.error(`env var is not set.`);
  process.exit(1);
}

const USER_DB_PATH = path.join(".", process.env.USER_DB_RELATIVE_PATH);

const users = {};
loadData();

function loadData() {
  try {
    if (fs.existsSync(USER_DB_PATH)) {
      const _users = JSON.parse(fs.readFileSync(USER_DB_PATH, "utf-8"));

      for (var k in _users) {
        users[k] = _users[k];
      }
    }
  } catch (error) {
    console.error("Error loading data: ", error);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const player = createAudioPlayer();

async function streamAudioResponse(message) {
  try {
    const permissions = message.channel.permissionsFor(client.user);

    if (
      !permissions.has(PermissionsBitField.Flags.Connect) ||
      !permissions.has(PermissionsBitField.Flags.Speak)
    ) {
      console.error("Permission error");
      return;
    }

    const connection = joinVoiceChannel({
      adapterCreator: message.channel.guild.voiceAdapterCreator,
      channelId: message.channel.id,
      guildId: message.channel.guild.id,
      selfDead: false,
      selfMute: false,
    });
    connection.subscribe(player);

    const userId = message.author.id;

    let gptPath = DEFAULT_GPT_PATH;
    let sovitsPath = DEFAULT_SOVITS_PATH;
    let promptPath = DEFAULT_PROMPT_PATH;
    let promptText = DEFAULT_PROMPT_TEXT;
    let promptLanguage = DEFAULT_PROMPT_LANGUAGE;

    loadData();

    if (userId in users) {
      const user = users[userId];

      if (user && user.useVoice !== 1) {
        switch (user.useVoice) {
          case 2:
            if (user.trainer && user.trainer.isReady) {
              gptPath = user.trainer.model.gptPath;
              sovitsPath = user.trainer.model.sovitsPath;
              promptPath = user.trainer.model.promptPath;
              promptText = user.trainer.model.promptText;
              promptLanguage = user.trainer.model.promptLanguage;
            }
            break;
          case 3:
            if (user.listener && user.listener.isReady) {
              gptPath = user.listener.model.gptPath;
              sovitsPath = user.listener.model.sovitsPath;
              promptPath = user.listener.model.promptPath;
              promptText = user.listener.model.promptText;
              promptLanguage = user.listener.model.promptLanguage;
            }
            break;
        }
      }
    }

    const response = await axios({
      headers: { Accept: "audio/raw" },
      method: "GET",
      params: {
        gpt_path: gptPath,
        prompt_language: promptLanguage,
        prompt_path: promptPath,
        prompt_text: promptText,
        sovits_path: sovitsPath,
        text: message.content,
        text_language: "auto",
      },
      responseType: "stream",
      url: "http://localhost:9880/tts",
    });

    const resource = createAudioResource(response.data, {
      inputType: StreamType.Raw,
    });
    resource.playStream.on("error", (error) =>
      console.error("Play stream error: ", error)
    );

    player.play(resource);
  } catch (error) {
    console.error("Error streaming audio: ", error);
  }
}

client.on("ready", () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.channel.isVoiceBased()) {
    await streamAudioResponse(message);
  }
});

client.on("error", console.error);

client.login(process.env.DISCORD_TOKEN);
