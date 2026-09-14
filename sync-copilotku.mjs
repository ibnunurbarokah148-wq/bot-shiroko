
import "dotenv/config";
import fs from "fs";

const API_KEY = process.env.COPILOTKU_API_KEY;

if (!API_KEY) {
  console.error("❌ COPILOTKU_API_KEY belum tersedia.");
  console.error("Set API key terlebih dahulu.");
  process.exit(1);
}

const COPILOTKU_URL = "https://anthropic.platfrom-claude.com/v1/models";
const CONFIG_FILE = "./opencode.json";
const CATALOG_FILE = "./copilotku-models.json";

async function main() {
  console.log("🔄 Mengambil daftar model dari Copilotku...");

  const response = await fetch(COPILOTKU_URL, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Copilotku API error: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  if (!Array.isArray(result.data)) {
    throw new Error("Format response Copilotku tidak sesuai.");
  }

  const models = result.data
    .filter(model => model.id)
    .map(model => ({
      id: model.id,
      name: model.display_name || model.id,
      provider: model.owned_by || "unknown",
    }));

  console.log(`✅ Ditemukan ${models.length} model.`);

  // Simpan katalog mentah yang sudah dirapikan
  fs.writeFileSync(
    CATALOG_FILE,
    JSON.stringify(models, null, 2),
    "utf8"
  );

  // Baca config OpenCode yang sudah ada
  let config = {};

  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf8")
    );
  }

  if (!config.provider) {
    config.provider = {};
  }

  if (!config.provider.copilotku) {
    config.provider.copilotku = {};
  }

  const copilotku = config.provider.copilotku;

  // Pertahankan konfigurasi provider yang sudah ada
  copilotku.npm ??= "@ai-sdk/openai-compatible";
  copilotku.name ??= "Copilotku Gateway";

  copilotku.options ??= {};
  copilotku.options.baseURL = "https://anthropic.platfrom-claude.com/v1";

  // Generate semua model
  const modelMap = {};

  for (const model of models) {
    modelMap[model.id] = {
      name: model.name,
    };
  }

  copilotku.models = modelMap;

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(config, null, 2) + "\n",
    "utf8"
  );

  console.log("✅ opencode.json berhasil diperbarui.");
  console.log(`📦 Total model Copilotku: ${models.length}`);

  console.log("\nModel tersedia:");

  for (const model of models) {
    console.log(
      `  • ${model.id} → ${model.name}`
    );
  }

  console.log("\n🎉 Sinkronisasi Copilotku selesai.");
}

main().catch(error => {
  console.error("\n❌ Sinkronisasi gagal:");
  console.error(error.message);
  process.exit(1);
});