<p align="center">
  <img src="Blue Archive.jpeg" width="300" alt="Shiroko Smug">
</p>

<h1 align="center">🐺 Shiroko Multi-Platform AI Bot (WhatsApp & Discord)</h1>

<p align="center">
  <b>Bot Asisten & Roleplay AI Multifungsi</b> yang mengadaptasi persona <b>Sunaookami Shiroko</b> dari <i>Blue Archive</i>.<br>
  Mendukung integrasi <b>WhatsApp (Baileys Engine)</b> & <b>Discord Bot (Discord.js v14)</b> dengan multi-provider AI Engine, Cloud GPU Image Rendering (ComfyUI/Vast.ai), serta sistem ekonomi & top-up QRIS.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/WhatsApp-Baileys-blue?style=flat-square&logo=whatsapp" alt="Baileys">
  <img src="https://img.shields.io/badge/Discord-Discord.js%20v14-5865F2?style=flat-square&logo=discord" alt="Discord.js">
  <img src="https://img.shields.io/badge/AI%20Engine-Gemini%20%7C%20OpenRouter%20%7C%20Cloudflare%20%7C%20Ollama%20%7C%20Arisu-orange?style=flat-square" alt="AI Engine">
</p>

---

## ✨ Fitur-Fitur Utama

### 🤖 1. Multi-Provider AI Engine (WhatsApp & Discord)
Bot ini dilengkapi dengan 5 penyedia AI utama yang terintegrasi penuh:
- **Google Gemini 2.5 Flash Lite**: Diotaki rotasi Multi-API Key untuk performa cepat dan bebas *rate limit*.
- **OpenRouter AI (Cloud)**: Bebas memilih ratusan model AI terkemuka (*DeepSeek R1, Llama 3.3 70B, Qwen 2.5 Coder, Mixtral, dll*).
- **Cloudflare Workers AI**: Dukungan *Multi-Account & Token Rotation* (`ACCOUNT_ID:TOKEN`) untuk 26+ model AI (*Llama 3, DeepSeek R1 Distill 32B, GPT-OSS 120B, Gemma 2, dll*).
- **Ollama (Lokal)**: Jalankan LLM secara lokal (*Llama 3, DeepSeek R1, Qwen, Gemma*).
- **ArisuSoft Satelit AI**: Pilihan model alternatif (*DeepSeek V3/V4, GLM, Qwen, GPT, Grok*).
- **3-Tier Automatic Payload Fallback**: Penanganan otomatis jika model menolak `role: 'system'` atau menggunakan format pilihan berlainan.
- **Auto Thinking Log Stripper**: Menyaring tag pemikiran (`<think>...</think>`) secara otomatis agar jawaban AI bersih dan langsung ke poin.
- **Unified Memory Reset (`!lupa`)**: Mereset riwayat memori percakapan di seluruh 5 provider AI dengan 1 perintah.

### 💖 2. Interactive Waifu Room Discord (`!mybini`)
- Pembuatan kamar rahasia privat per-user dengan waifu impian (*Shiroko, Yae Miko, Furina, Columbina, Sandrone, Miwa, Kafka, Hu Tao, Cantarella, Jane Doe*).
- Interactive Select Menu di Discord untuk memilih penyedia & model AI spesifik.
- Sistem auto-delete channel saat AFK / tidak ada aktivitas selama 3 menit.

### 🎨 3. Multi-Provider Image Rendering (ComfyUI, Cloudflare AI & ArisuSoft)
- **Interactive 2-Step Menu (`!gambar`)**: Alur menu interaktif 2 tahap (Pilihan Provider/Server ➔ Pilihan Model Spesifik).
- **Vast.ai Cloud GPU Integration**: Render gambar SDXL/Illustrious XL kualitas tinggi via ComfyUI di server cloud GPU dengan auto-start & **Auto-Stop 1-Minute Idle**.
- **Cloudflare Workers AI Image Generation**: Pemindaian dinamis (*Live Scanning*) untuk model gambar (*FLUX.1 Schnell, SDXL Lightning, DreamShaper 8 Anime, Leonardo Phoenix 1.0, SDXL Base 1.0, Leonardo Lucid Origin*).
- **Automatic Magic-Bytes & Base64 Decoder**: Penanganan otomatis MIME type (PNG/JPEG/WEBP) & decoder payload Base64 JSON agar gambar dipastikan 100% bisa di-download dan dibuka di WhatsApp.
- **Satelit ArisuSoft Fallback**: Pengalihan otomatis ke server ArisuSoft (*SDXL Turbo, Agnes 2.0, Agnes 2.1*) jika server utama sedang offline.

### 📚 4. Operasi Akademik & LMS
- **Generator Karya Ilmiah**: Pembuat Makalah, Artikel, dan Laporan (700-1600 kata) terstruktur otomatis.
- **Socratic Method Exam System**: Ujian interaktif studi kasus yang mengevaluasi pemahaman siswa.
- **Crossref Journal Finder**: Mencari referensi dan paper ilmiah acak.
- **Parafrase & Ringkas Teks**: Pengolah teks anti-plagiasi dan pembuat intisari *bullet points*.

### 🏦 5. Sistem Ekonomi, Limit & Top-Up QRIS Dynamic
- **Limit Token Daily & Status Premium**: Pembatasan penggunaan harian untuk user gratisan (reset pukul 00:00 WIB).
- **QRIS Dynamic Decoder**: Fitur `!topup` yang secara otomatis mengurai QRIS Static DANA menjadi QRIS Dynamic sesuai nominal pesanan token limit.

### 🛠️ 6. Utilitas Media & Intel
- **Cloudflare Text-to-Speech (TTS) Voice Note (`!tts` / `!suara`)**: Mengubah teks apapun menjadi pesan suara / Voice Note (VN) jernih langsung di WhatsApp via Cloudflare AI (*MeloTTS, Deepgram Aura*).
- **TikTok Downloader**: Download Video (tanpa Watermark), Audio, atau Slideshow Foto.
- **Visual Search**: Pencarian gambar anime resolusi tinggi dari **Pixiv** (Multi-page support), **Danbooru**, dan **Nekosia**.
- **PDF to JPG Converter**: Memecah dokumen PDF menjadi gambar HD.
- **Voice Note Transcriber**: Mengubah pesan suara (Voice Note) WhatsApp menjadi teks (Speech-to-Text).
- **Sticker Maker & Emotional Alarm**: Konversi foto ke stiker WA dan sistem pengingat ibadah interaktif.

---

## 🛠️ Panduan Instalasi & Penggunaan

### 📦 1. Panduan Instalasi Prasyarat (Node.js, Git, PM2)

#### 🐧 A. Di Linux VPS (Ubuntu / Debian)
Jalankan perintah berikut di terminal VPS kamu secara berurutan:

1. **Update Package Manager:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
2. **Install Git & Dependency Dasar:**
   ```bash
   sudo apt install -y git curl build-essential
   ```
3. **Install Node.js (v20 LTS via NodeSource):**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
   *Verifikasi versi dengan `node -v` (harus v18/v20+) dan `npm -v`.*

4. **Install PM2 (Process Manager Global):**
   ```bash
   sudo npm install -g pm2
   ```
   *Supaya bot otomatis menyala kembali jika VPS di-reboot:*
   ```bash
   pm2 startup
   pm2 save
   ```

#### 🪟 B. Di Windows (Komputer / Laptop)
1. **Install Git:** Download installer dari [git-scm.com](https://git-scm.com/downloads) dan jalankan setup (pilih opsi default).
2. **Install Node.js:** Download versi LTS dari [nodejs.org](https://nodejs.org/) dan ikuti petunjuk installer.
3. **Install PM2 (Opsional):** Buka CMD / Terminal lalu jalankan:
   ```cmd
   npm install -g pm2
   ```

---

### 🚀 2. Langkah-Langkah Instalasi & Eksekusi Bot

1. **Clone Repositori:**
   ```bash
   git clone https://github.com/ibnunurbarokah148-wq/bot-shiroko.git
   cd bot-shiroko
   ```

2. **Install Dependensi:**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment (`.env`):**
   Salin file template `.env.example` atau buat file `.env` baru di folder utama bot (baca section **Template File `.env`** di bawah).

4. **Jalankan Bot WhatsApp:**
   ```bash
   # Jalankan langsung
   npm start
   
   # Atau menggunakan PM2 (Rekomendasi VPS)
   pm2 start index.js --name "shiroko-wa"
   ```

5. **Jalankan Bot Discord (Opsional):**
   ```bash
   # Jalankan bot Discord di proses terpisah
   node bot-dc.js
   
   # Atau menggunakan PM2
   pm2 start bot-dc.js --name "shiroko-dc"
   ```

6. **Hubungkan WhatsApp:**
   Pindai (Scan) Kode QR yang muncul di terminal menggunakan aplikasi WhatsApp di HP kamu (*Perangkat Tertaut / Linked Devices*).

---

## 🔑 Template File `.env`

Buat file bernama `.env` di direktori utama repositori kamu dan isi dengan struktur berikut:

```env
# ==========================================
# 🤖 GOOGLE GEMINI AI CONFIGURATION
# (Mendukung multi-key dipisahkan koma untuk rotasi)
# ==========================================
GEMINI_API_KEY=AIzaSyxxxxxxxxx,AIzaSyyyyyyyyyy

# ==========================================
# 🌐 OPENROUTER AI CONFIGURATION
# (Mendukung multi-key dipisahkan koma)
# ==========================================
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ==========================================
# ☁️ CLOUDFLARE WORKERS AI CONFIGURATION
# Format: ACCOUNT_ID:API_TOKEN
# (Mendukung multi-account dipisahkan koma untuk load balancing)
# ==========================================
CLOUDFLARE_API_TOKEN=account_id_1:token_1,account_id_2:token_2

# ==========================================
# 🛰️ ARISUSOFT & OTHER AI SERVICES
# ==========================================
ARISU_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxx

# ==========================================
# 🎮 DISCORD BOT CONFIGURATION
# ==========================================
DISCORD_TOKEN=MTUxNzA...........................

# ==========================================
# 🎨 COMFYUI & VAST.AI CLOUD GPU CONFIGURATION
# ==========================================
VAST_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAST_INSTANCE_ID=12345678

# ==========================================
# 🖼️ MEDIA & CONVERTER SERVICES
# ==========================================
PIXIV_REFRESH_TOKEN=vYlnmRWf_xxxxxxxxxxxxxxxxxxxx
CONVERT_API_KEY=iDYQeBgxxxxxxxxxxxxxxxxxx
CIVITAI_API_KEY=2cec05b7xxxxxxxxxxxxxxxxxxxx

# ==========================================
# 📱 WHATSAPP & QRIS CONFIGURATION
# ==========================================
WA_PHONE_NUMBER=628xxxxxxxxx
STATIC_QRIS=00020101021126570011ID.DANA.WWW...
```

---

## 📄 Lisensi & Kontribusi

Dikembangkan untuk kebutuhan pembelajaran dan komunitas. Bebas dikembangkan kembali dengan tetap mencantumkan kredit ke pembuat awal.

> *"Nn... Serahkan urusan taktis ini pada Shiroko, Sensei!"* 🐺