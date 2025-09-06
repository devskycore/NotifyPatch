const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
} = require("discord.js");
const axios = require("axios");
const express = require("express");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const winston = require("winston");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const DATA_FILE = "./data.json";
const USER_AGENT = "notifypatch-bot/1.0";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Logger con Winston
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ level, message, timestamp }) =>
        `[${timestamp}] ${level.toUpperCase()}: ${message}`,
    ),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "bot.log" }),
  ],
});

// Cargar datos persistentes
let botData = {
  lastVersion: "",
  lastBuild: "",
  lastBuildsData: [],
};

async function loadData() {
  try {
    if (await fs.pathExists(DATA_FILE)) {
      botData = await fs.readJson(DATA_FILE);
      logger.info("Datos cargados desde archivo JSON");
    }
  } catch (error) {
    logger.error("Error al cargar datos persistentes: " + error.message);
  }
}

async function saveData() {
  try {
    await fs.writeJson(DATA_FILE, botData, { spaces: 2 });
    logger.info("Datos guardados en archivo JSON");
  } catch (error) {
    logger.error("Error al guardar datos persistentes: " + error.message);
  }
}

async function makeRequest(url, options = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    ...options.headers,
  };

  try {
    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      ...options,
    });
    return response;
  } catch (error) {
    logger.error(`Error en la solicitud a ${url}: ${error.message}`);
    throw error;
  }
}

async function fetchPaperDataFromAPI() {
  try {
    logger.info("🔍 Consultando API de PaperMC...");
    const versionRes = await makeRequest(
      "https://api.papermc.io/v2/projects/paper",
    );
    const versions = versionRes.data.versions;
    const version = versions[versions.length - 1];

    const buildRes = await makeRequest(
      `https://api.papermc.io/v2/projects/paper/versions/${version}`,
    );
    const builds = buildRes.data.builds;
    const build = builds[builds.length - 1];

    const detailsRes = await makeRequest(
      `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}`,
    );
    const details = detailsRes.data;

    const changelog = details.changes
      ?.slice(0, 3)
      .map((c) => `🛠️ ${c.summary}`) || [
      "⚠️ No hay información de cambios disponible",
    ];
    const time = new Date(details.time).toLocaleString("es-AR");
    const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;

    logger.info(`✅ API exitosa: Paper ${version} Build #${build}`);
    return { version, build, changelog, time, downloadUrl };
  } catch (error) {
    logger.warn("❌ API falló, no se pudo obtener datos");
    throw error;
  }
}

async function checkPaperUpdates() {
  try {
    logger.info("🔄 Verificando actualizaciones...");
    const data = await fetchPaperDataFromAPI();

    if (
      data.version !== botData.lastVersion ||
      data.build !== botData.lastBuild
    ) {
      logger.info(
        `📦 Nueva versión detectada: Paper ${data.version} Build #${data.build}`,
      );

      botData.lastVersion = data.version;
      botData.lastBuild = data.build;
      botData.lastBuildsData.unshift({
        version: data.version,
        build: data.build,
        changelog: data.changelog,
        time: data.time,
        downloadUrl: data.downloadUrl,
      });
      botData.lastBuildsData = botData.lastBuildsData.slice(0, 5); // Máximo 5 builds
      await saveData();

      const embed = new EmbedBuilder()
        .setTitle(`📰 Nueva versión de PaperMC`)
        .setColor(0x00bfff)
        .addFields(
          { name: "📦 Versión", value: `Paper ${data.version}`, inline: true },
          { name: "🔨 Build", value: `#${data.build}`, inline: true },
          {
            name: "📜 Cambios recientes",
            value: data.changelog.join("\n").slice(0, 1024) || "No hay cambios",
          },
          {
            name: "🕒 Fecha",
            value: data.time.slice(0, 1024) || "Fecha no disponible",
          },
          {
            name: "📥 Descargar",
            value: `[Haz clic aquí](${data.downloadUrl})`,
          },
        )
        .setTimestamp()
        .setFooter({ text: "PaperMC Update Bot" });

      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [embed] });
    } else {
      logger.info("✅ No hay nuevas actualizaciones");
    }
  } catch (error) {
    logger.error("❌ Error al verificar actualizaciones: " + error.message);
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(
      "⚠️ No se pudo verificar actualizaciones de PaperMC. Intenta más tarde.",
    );
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "estado") {
      try {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Estado actual de PaperMC`)
          .setColor(0x00ff88)
          .setTimestamp()
          .setFooter({ text: "PaperMC Status Bot" });

        const version = botData.lastVersion || "No disponible";
        const build = botData.lastBuild || "No disponible";

        embed.addFields(
          { name: "📦 Versión", value: String(version), inline: true },
          { name: "🔨 Build", value: String(build), inline: true },
        );

        const recentBuild = botData.lastBuildsData[0];
        const changelog = Array.isArray(recentBuild?.changelog)
          ? recentBuild.changelog.join("\n").slice(0, 1024)
          : "No hay información disponible";

        const downloadUrl =
          recentBuild?.downloadUrl || "https://papermc.io/downloads/paper";

        embed.addFields(
          {
            name: "📜 Cambios recientes",
            value: changelog || "No hay información disponible",
          },
          { name: "📥 Descargar", value: `[Haz clic aquí](${downloadUrl})` },
        );

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        logger.error(`Error en comando estado: ${error.message}`);
        await interaction.reply({
          content: "❌ Ocurrió un error al procesar el comando",
          flags: 64, // reemplaza "ephemeral: true"
        });
      }
    }

    if (interaction.commandName === "build") {
      await interaction.reply(
        botData.lastVersion && botData.lastBuild
          ? `🔨 Build actual: **Paper ${botData.lastVersion} Build #${botData.lastBuild}**`
          : "⚠️ No hay información de build disponible",
      );
    }

    if (interaction.commandName === "historial") {
      const embed = new EmbedBuilder()
        .setTitle("📜 Historial de Builds")
        .setColor(0xffcc00)
        .setTimestamp()
        .setFooter({ text: "PaperMC History Bot" });

      if (botData.lastBuildsData && botData.lastBuildsData.length > 0) {
        // Limitar a 3 builds para no exceder el límite de campos
        const limitedBuilds = botData.lastBuildsData.slice(0, 3);

        for (const build of limitedBuilds) {
          const changelogText =
            build.changelog?.join("\n") || "No hay cambios disponibles";
          const timeText = build.time || "Fecha no disponible";
          const downloadText =
            build.downloadUrl || "https://papermc.io/downloads/paper";

          embed.addFields({
            name: `📦 Paper ${build.version} Build #${build.build}`,
            value: `${changelogText.slice(0, 500)}\n🕒 ${timeText.slice(0, 100)}\n📥 [Descargar](${downloadText})`,
          });
        }
      } else {
        embed.setDescription("⚠️ No hay historial de builds disponible");
      }

      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    logger.error(
      `Error en comando ${interaction.commandName}: ${error.message}`,
    );
    await interaction.reply({
      content: "❌ Ocurrió un error al procesar el comando",
      ephemeral: true,
    });
  }
});

async function registerCommands() {
  const commands = [
    {
      name: "estado",
      description: "Muestra la versión actual y las últimas builds de PaperMC",
    },
    {
      name: "build",
      description: "Muestra la build actual detectada por el bot",
    },
    {
      name: "historial",
      description: "Muestra el historial de builds recientes",
    },
  ];

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    logger.info("✅ Comandos registrados correctamente");
  } catch (error) {
    logger.error("❌ Error registrando comandos: " + error.message);
  }
}

client.once("clientReady", async () => {
  logger.info(`✅ Bot iniciado como ${client.user.tag}`);

  registerCommands()
    .then(() => {
      logger.info("✅ Comandos registrados después del ready");

      (async () => {
        try {
          const channel = await client.channels.fetch(CHANNEL_ID);

          const lastBuild = botData.lastBuildsData[0];
          const version = botData.lastVersion || "No disponible";
          const build = botData.lastBuild || "No disponible";
          const changelog = Array.isArray(lastBuild?.changelog)
            ? lastBuild.changelog.join("\n").slice(0, 1024)
            : "No hay información disponible";
          const time = lastBuild?.time || new Date().toLocaleString("es-AR");
          const downloadUrl =
            lastBuild?.downloadUrl || "https://papermc.io/downloads/paper";

          const embed = new EmbedBuilder()
            .setTitle("🔄 Bot reiniciado correctamente")
            .setDescription(
              "El bot se ha encendido y está monitoreando actualizaciones de PaperMC.",
            )
            .setColor(0x00ffcc)
            .addFields(
              { name: "📦 Versión", value: `Paper ${version}`, inline: true },
              { name: "🔨 Build", value: `#${build}`, inline: true },
              { name: "📜 Cambios recientes", value: changelog },
              { name: "🕒 Fecha", value: time },
              {
                name: "📥 Descargar",
                value: `[Haz clic aquí](${downloadUrl})`,
              },
            )
            .setTimestamp()
            .setFooter({ text: "PaperMC Update Bot" });

          await channel.send({ embeds: [embed] });
          logger.info("📣 Mensaje de arranque enviado al canal");
        } catch (error) {
          logger.error(
            "❌ Error al enviar mensaje de arranque: " + error.message,
          );
        }
      })();

      // Verificar inmediatamente al iniciar (con delay)
      setTimeout(checkPaperUpdates, 2000);

      // Verificar cada 5 minutos
      setInterval(checkPaperUpdates, 5 * 60 * 1000);
    })
    .catch((error) => {
      logger.error("❌ Error al registrar comandos: " + error.message);
    });
});

client.login(DISCORD_TOKEN).catch((error) => {
  logger.error("❌ Error al iniciar sesión: " + error.message);
});

const app = express();
app.get("/", (req, res) => {
  res.send("✅ Bot is alive!");
});

// Adaptado
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🌍 Servidor web activo en puerto ${PORT}`);
});

// Cargar datos al iniciar
loadData().catch((error) => {
  logger.error("Error al cargar datos iniciales: " + error.message);
});

