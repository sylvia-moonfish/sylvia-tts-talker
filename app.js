const DEFAULT_GPT_PATH =
  "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt";
const DEFAULT_SOVITS_PATH =
  "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth";
const DEFAULT_PROMPT_PATH = "GPT_SoVITS/pretrained_models/default_prompt.wav";
const DEFAULT_PROMPT_TEXT = "그는 괜찮은 척하려고 애쓰는 것 같았다.";
const DEFAULT_PROMPT_LANGUAGE = "all_ko";

const PUNCTUATIONS = [
  "，",
  "。",
  "？",
  "！",
  ",",
  ".",
  "?",
  "!",
  "~",
  ":",
  "：",
  "—",
  "…",
];

require("dotenv").config();

const {
  AudioPlayerStatus,
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

const guilds = {};

class GuildAudioManager {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.player = createAudioPlayer();
    this.isPlaying = false;

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.isPlaying = false;
      this.playNext();
    });

    this.player.on("error", (error) => {
      console.error(`Error in guild ${guildId}: `, error);

      this.isPlaying = false;
      this.playNext();
    });
  }

  split(text) {
    text = text
      .trim()
      .replaceAll("……", ".")
      .replaceAll("——", ",")
      .replaceAll("ㅋ", "크")
      .replaceAll("ㅎ", "헤")
      .replaceAll("ㅠ", "유");

    if (!PUNCTUATIONS.includes(text[text.length - 1])) {
      text += ".";
    }

    const lines = [];
    let chars = [];

    for (let i = 0; i < text.length; i++) {
      if (
        i > 3 &&
        text[i - 4] === text[i - 3] &&
        text[i - 3] === text[i - 2] &&
        text[i - 2] === text[i - 1] &&
        text[i - 1] === text[i]
      )
        continue;

      chars.push(text[i]);

      if (PUNCTUATIONS.includes(text[i])) {
        lines.push(chars.join("").trim());
        chars = [];
      }
    }

    return lines;
  }

  processMessage(message) {
    const userId = message.author.id;
    const text = message.content;

    const lines = this.split(text);
    const results = [];
    let curLine = "";

    lines.forEach((line) => {
      curLine += line;

      if (curLine.length > 10) {
        results.push({ userId, text: curLine });
        curLine = "";
      }
    });

    if (curLine.length > 0) results.push({ userId, text: curLine });

    return results;
  }

  async addToQueue(message) {
    const messages = this.processMessage(message);
    messages.forEach((m) => this.queue.push(m));

    if (!this.isPlaying) {
      await this.playNext();
    }
  }

  async playNext() {
    if (this.queue.length === 0) return;

    const message = this.queue.shift();
    this.isPlaying = true;

    try {
      await this.playAudio(message);
    } catch (error) {
      console.error(`Error playing audio: `, error);

      this.isPlaying = false;
      this.playNext();
    }
  }

  async playAudio(message) {
    const userId = message.userId;

    let gptPath = DEFAULT_GPT_PATH;
    let sovitsPath = DEFAULT_SOVITS_PATH;
    let promptPath = DEFAULT_PROMPT_PATH;
    let promptText = DEFAULT_PROMPT_TEXT;
    let promptLanguage = DEFAULT_PROMPT_LANGUAGE;

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
        text: message.text,
        text_language: "auto",
      },
      responseType: "stream",
      url: "http://localhost:9880/tts",
    });

    const resource = createAudioResource(response.data, {
      inputType: StreamType.Raw,
    });

    resource.playStream.on("error", (error) => {
      console.error("Play stream error: ", error);

      this.isPlaying = false;
      this.playNext();
    });

    this.player.play(resource);
  }
}

async function streamAudioResponse(message) {
  if (!message || !message.content || !message.author) return;
  if (
    message.content[0] === ":" &&
    message.content[message.content.length - 1] === ":"
  )
    return;
  if (message.content.startsWith("https:")) return;

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

    const guildId = message.guild.id;

    if (!guilds[guildId]) guilds[guildId] = new GuildAudioManager(guildId);

    connection.subscribe(guilds[guildId].player);

    await guilds[guildId].addToQueue(message);
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
