import fs from "fs";

const API_KEY = process.env.XKIRO_API_KEY;

if (!API_KEY) {
  console.error("❌ XKIRO_API_KEY belum tersedia.");
  console.error("Set API key terlebih dahulu.");
  process.exit(1);
}

const XKIRO_URL = "https://api.xkiro.com/v1/models";
const CONFIG_FILE = "./opencode.json";
const CATALOG_FILE = "./xkiro-models.json";

async function main() {
  console.log("🔄 Mengambil daftar model dari xKiro...");

  const response = await fetch(XKIRO_URL, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `xKiro API error: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  if (!Array.isArray(result.data)) {
    throw new Error("Format response xKiro tidak sesuai.");
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

  if (!config.provider.xkiro) {
    config.provider.xkiro = {};
  }

  const xkiro = config.provider.xkiro;

  // Pertahankan konfigurasi provider yang sudah ada
  xkiro.npm ??= "@ai-sdk/openai-compatible";
  xkiro.name ??= "xKiro Gateway";

  xkiro.options ??= {};
  xkiro.options.baseURL ??= "https://api.xkiro.com/v1";

  // Generate semua model
  const modelMap = {};

  for (const model of models) {
    modelMap[model.id] = {
      name: model.name,
    };
  }

  xkiro.models = modelMap;

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(config, null, 2) + "\n",
    "utf8"
  );

  console.log("✅ opencode.json berhasil diperbarui.");
  console.log(`📦 Total model xKiro: ${models.length}`);

  console.log("\nModel tersedia:");

  for (const model of models) {
    console.log(
      `  • ${model.id} → ${model.name}`
    );
  }

  console.log("\n🎉 Sinkronisasi xKiro selesai.");
}

main().catch(error => {
  console.error("\n❌ Sinkronisasi gagal:");
  console.error(error.message);
  process.exit(1);
});