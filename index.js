require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags
} = require("discord.js");

const { Pool } = require("pg");
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_URL = process.env.API_URL || "https://axolt-api.onrender.com"; // Change ceci par ton URL Render

// Les deux ID autorisés à utiliser les commandes d'administration
const ADMIN_USER_IDS = ["1511750740518109334", "1163514075217678527"]; 
const BUYER_ROLE_ID = "1556423476481490944"; // Ton rôle acheteur

// ============================================
// POSTGRESQL CONNECTION (SUPABASE)
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      whitelist INTEGER DEFAULT 0,
      blacklist INTEGER DEFAULT 0,
      key_id INTEGER,
      hwid TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      redeemed_by TEXT,
      redeemed_at BIGINT,
      status TEXT DEFAULT 'unused'
    )
  `);
  console.log("Database connected.");
  console.log("Tables ready.");
}

initDB().catch(err => {
  console.error("DB init error:", err);
});

// ============================================
// HELPERS
// ============================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAdmin(interaction) {
  return ADMIN_USER_IDS.includes(interaction.user.id);
}

function generateKey() {
  const a = crypto.randomBytes(4).toString("hex").toUpperCase();
  const b = crypto.randomBytes(4).toString("hex").toUpperCase();
  const c = crypto.randomBytes(4).toString("hex").toUpperCase();
  return "KEY-" + a + "-" + b + "-" + c;
}

// ============================================
// COMMANDS
// ============================================
const commands = [
  new SlashCommandBuilder().setName("panel").setDescription("Show the authentication panel"),
  new SlashCommandBuilder().setName("genkey").setDescription("Generate a lifetime license key"),
  new SlashCommandBuilder().setName("deletekey").setDescription("Delete a specific user's license")
    .addUserOption(o => o.setName("user").setDescription("User whose license should be deleted").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  console.log("Registering slash commands...");
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Slash commands registered.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
}

client.once("clientReady", async () => {
  console.log("Bot connected: " + client.user.tag);
  await registerCommands();
});

// ============================================
// INTERACTIONS
// ============================================
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {

      // --- PANEL ---
      if (interaction.commandName === "panel") {
        const embed = new EmbedBuilder()
          .setTitle("🔐 Axolt")
          .setDescription(
            "**Welcome to Axolt.**\n\n" +
            "Manage your license using the buttons below.\n\n" +
            "🎟️ **Redeem Key** — redeem your license key.\n" +
            "📜 **Get Script** — get your personal loader.\n" +
            "🔑 **Check Key** — view your license information.\n" +
            "🔄 **Reset HWID** — reset your HWID."
          )
          .setFooter({ text: "Axolt • made by @expliquez" });

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("redeem_key").setLabel("Redeem Key").setEmoji("🎟️").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("get_script").setLabel("Get Script").setEmoji("📜").setStyle(ButtonStyle.Success)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("check_key").setLabel("Check Key").setEmoji("🔑").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("reset_hwid").setLabel("Reset HWID").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row1, row2] });
        return;
      }

      // --- GENKEY ---
      if (interaction.commandName === "genkey") {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
        }
        const key = generateKey();
        await pool.query("INSERT INTO keys (key, status) VALUES ($1, 'unused')", [key]);
        await interaction.reply({ 
          content: "🔑 **License Generated**\n\n" + key + "\n\n**Status:** Unused", 
          flags: MessageFlags.Ephemeral 
        });
        return;
      }

      // --- DELETEKEY ---
      if (interaction.commandName === "deletekey") {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
        }
        const user = interaction.options.getUser("user");
        const res = await pool.query("SELECT key_id FROM users WHERE discord_id = $1", [user.id]);
        
        if (!res.rows[0] || !res.rows[0].key_id) {
          return interaction.reply({ content: "❌ No license.", flags: MessageFlags.Ephemeral });
        }
        
        await pool.query("UPDATE keys SET status = 'deleted' WHERE id = $1", [res.rows[0].key_id]);
        await pool.query("UPDATE users SET key_id = NULL, hwid = NULL WHERE discord_id = $1", [user.id]);
        
        await interaction.reply({ content: "🗑️ License deleted for " + user, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    // ============================================
    // BOUTONS
    // ============================================
    if (interaction.isButton()) {

      // --- REDEEM KEY (MODAL) ---
      if (interaction.customId === "redeem_key") {
        const modal = new ModalBuilder().setCustomId("redeem_modal").setTitle("Redeem License Key");
        const input = new TextInputBuilder()
          .setCustomId("license_key")
          .setLabel("License Key")
          .setPlaceholder("KEY-XXXXXXXX-XXXXXXXX-XXXXXXXX")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      // --- GET SCRIPT ---
      if (interaction.customId === "get_script") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await pool.query("SELECT * FROM users WHERE discord_id = $1", [interaction.user.id]);
        const userData = result.rows[0];

        if (!userData || !userData.key_id) {
          return interaction.editReply({ content: "❌ You do not have an active license." });
        }

        const keyResult = await pool.query("SELECT * FROM keys WHERE id = $1", [userData.key_id]);
        const keyData = keyResult.rows[0];
        
        if (!keyData || keyData.status !== "redeemed") {
          return interaction.editReply({ content: "❌ Your license is not active." });
        }

        const msg = `Here is your loader. Copy these lines into your executor:\n\n` +
                    `getgenv().axolt_key = "${keyData.key}"\n` +
                    `loadstring(game:HttpGet("${API_URL}/static_loader"))()\n\n` +
                    `⚠️ **Do not share this code**`;

        return interaction.editReply({ content: msg });
      }

      // --- CHECK KEY ---
      if (interaction.customId === "check_key") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await pool.query("SELECT * FROM users WHERE discord_id = $1", [interaction.user.id]);
        const userData = result.rows[0];

        if (!userData || !userData.key_id) {
          return interaction.editReply({ content: "❌ You do not have an active license." });
        }

        const keyResult = await pool.query("SELECT * FROM keys WHERE id = $1", [userData.key_id]);
        const keyData = keyResult.rows[0];
        
        if (!keyData || keyData.status !== "redeemed") {
          return interaction.editReply({ content: "❌ Your license is not active." });
        }

        const embed = new EmbedBuilder()
          .setTitle("🔑 Your Key Information")
          .setDescription(
            "**Key:** `" + keyData.key + "`\n" +
            "**Status:** Active\n" +
            "**HWID:** " + (userData.hwid || "Not registered") + "\n" +
            "**Redeemed:** " + (keyData.redeemed_at ? `<t:${Math.floor(keyData.redeemed_at / 1000)}:R>` : "Unknown")
          )
          .setColor(0x00FF00)
          .setFooter({ text: "Axolt • made by @expliquez" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("self_delete_key").setLabel("Delete Key").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        );
        
        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      // --- SELF DELETE KEY (Action du bouton dans Check Key) ---
      if (interaction.customId === "self_delete_key") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await pool.query("SELECT key_id FROM users WHERE discord_id = $1", [interaction.user.id]);
        const userData = result.rows[0];

        if (!userData || !userData.key_id) {
          return interaction.editReply({ content: "❌ You do not have an active license." });
        }

        await pool.query("UPDATE keys SET status = 'deleted' WHERE id = $1", [userData.key_id]);
        await pool.query("UPDATE users SET key_id = NULL, hwid = NULL WHERE discord_id = $1", [interaction.user.id]);
        
        return interaction.editReply({ content: "✅ Your key has been successfully deleted." });
      }

      // --- RESET HWID (Self) ---
      if (interaction.customId === "reset_hwid") {
        const result = await pool.query("SELECT * FROM users WHERE discord_id = $1", [interaction.user.id]);
        const userData = result.rows[0];
        
        if (userData && userData.blacklist === 1) {
          return interaction.reply({ content: "🚫 Blacklisted.", flags: MessageFlags.Ephemeral });
        }
        if (!userData || !userData.key_id) {
          return interaction.reply({ content: "❌ No license.", flags: MessageFlags.Ephemeral });
        }

        await pool.query("UPDATE users SET hwid = NULL WHERE discord_id = $1", [interaction.user.id]);
        return interaction.reply({ content: "✅ HWID reset successfully.", flags: MessageFlags.Ephemeral });
      }
    }

    // ============================================
    // MODALS
    // ============================================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "redeem_modal") {
        const key = interaction.fields.getTextInputValue("license_key").trim();
        const existingResult = await pool.query("SELECT * FROM users WHERE discord_id = $1", [interaction.user.id]);
        const existingUser = existingResult.rows[0];

        if (existingUser && existingUser.blacklist === 1) {
          return interaction.reply({ content: "🚫 Blacklisted.", flags: MessageFlags.Ephemeral });
        }
        if (existingUser && existingUser.key_id) {
          const currentKeyResult = await pool.query("SELECT * FROM keys WHERE id = $1", [existingUser.key_id]);
          if (currentKeyResult.rows[0] && currentKeyResult.rows[0].status === "redeemed") {
            return interaction.reply({ content: "❌ Already have a license.", flags: MessageFlags.Ephemeral });
          }
        }

        const keyResult = await pool.query("SELECT * FROM keys WHERE key = $1", [key]);
        const keyData = keyResult.rows[0];
        
        if (!keyData) return interaction.reply({ content: "❌ Invalid key.", flags: MessageFlags.Ephemeral });
        if (keyData.status !== "unused") return interaction.reply({ content: "❌ Key already used or deleted.", flags: MessageFlags.Ephemeral });

        const now = Date.now();
        await pool.query("UPDATE keys SET redeemed_by = $1, redeemed_at = $2, status = 'redeemed' WHERE id = $3", [interaction.user.id, now, keyData.id]);
        await pool.query("INSERT INTO users (discord_id, whitelist, blacklist, key_id, hwid) VALUES ($1, 0, 0, $2, NULL) ON CONFLICT (discord_id) DO UPDATE SET key_id = $2, blacklist = 0", [interaction.user.id, keyData.id]);

        if (interaction.guild) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(BUYER_ROLE_ID)) await member.roles.add(BUYER_ROLE_ID);
          } catch (error) {}
        }
        
        return interaction.reply({ content: "✅ **License Redeemed!**", flags: MessageFlags.Ephemeral });
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

// ============================================
// LOGIN
// ============================================
client.login(TOKEN).then(() => {
  console.log("Login successful.");
}).catch(error => {
  console.error("Bot login error:", error);
});
