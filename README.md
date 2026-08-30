<p align="center">
  <img src="Blue Archive.jpeg" width="300" alt="Shiroko Smug">
</p>

<h1 align="center">🐺 Shiroko Multi-Platform AI Bot (WhatsApp & Discord)</h1>

<p align="center">
  <b>Bot Asisten & Roleplay AI Multifungsi</b> yang mengadaptasi persona <b>Sunaookami Shiroko</b> dari <i>Blue Archive</i>.<br>
  Mendukung integrasi <b>WhatsApp (Baileys Engine)</b> & <b>Discord Bot (Discord.js v14)</b> dengan multi-provider AI Engine, generator gambar, bot Minecraft, dashboard web, serta sistem ekonomi & top-up QRIS.
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
Bot ini mendukung beberapa provider AI yang dapat dipilih melalui mode AI:
- **Google Gemini**: Mendukung rotasi beberapa API key.
- **OpenRouter AI**: Pemindaian model dan pemilihan model dari gateway OpenRouter.
- **Cloudflare Workers AI**: Mendukung beberapa account/token.
- **Ollama (Lokal)**: Menjalankan model LLM dari komputer/server lokal.
- **ArisuSoft**: Provider satelit dengan beberapa pilihan model.
- **xKiro**: Gateway multi-model dengan akses model berdasarkan status Premium.
- **Fallback payload otomatis**: Menangani perbedaan format provider dan membersihkan output thinking seperti `<think>...</think>`.
- **Auto Thinking Log Stripper**: Menyaring tag pemikiran (`<think>...</think>`) secara otomatis agar jawaban AI bersih dan langsung ke poin.
- **Unified Memory Reset (`!lupa`)**: Mereset riwayat memori percakapan di seluruh 5 provider AI dengan 1 perintah.

### 💖 2. Interactive Waifu Room Discord (`!mybini`)
- Pembuatan kamar rahasia privat per-user dengan waifu impian (*Shiroko, Yae Miko, Furina, Columbina, Sandrone, Miwa, Kafka, Hu Tao, Cantarella, Jane Doe*).
- Interactive Select Menu di Discord untuk memilih penyedia & model AI spesifik.
- Sistem auto-delete channel saat AFK / tidak ada aktivitas selama 3 menit.

### 🎨 3. Multi-Provider Image Rendering (PixAI, ComfyUI, Cloudflare AI & ArisuSoft)
- **Interactive 2-Step Menu (`!gambar`)**: Alur menu interaktif 2 tahap (Pilihan Provider/Server ➔ Pilihan Model Spesifik).
- **PixAI.art (`!pixai`)**: Generator gambar anime dengan antrean, dukungan multi-token, auto-refresh credential, dan fallback GraphQL/REST.
- **Vast.ai Cloud GPU Integration**: Render gambar melalui ComfyUI di server cloud GPU dengan auto-start dan auto-stop saat idle.
- **Cloudflare Workers AI Image Generation**: Pemindaian dinamis (*Live Scanning*) untuk model gambar (*FLUX.1 Schnell, SDXL Lightning, DreamShaper 8 Anime, Leonardo Phoenix 1.0, SDXL Base 1.0, Leonardo Lucid Origin*).
- **Automatic Magic-Bytes & Base64 Decoder**: Penanganan otomatis MIME type (PNG/JPEG/WEBP) & decoder payload Base64 JSON agar gambar dipastikan 100% bisa di-download dan dibuka di WhatsApp.
- **Satelit ArisuSoft Fallback**: Pengalihan otomatis ke server ArisuSoft (*SDXL Turbo, Agnes 2.0, Agnes 2.1*) jika server utama sedang offline.

### 📚 4. Operasi Akademik & LMS
- **Generator Karya Ilmiah**: Pembuat Makalah, Artikel, dan Laporan (700-1600 kata) terstruktur otomatis.
- **Socratic Method Exam System**: Ujian interaktif studi kasus yang mengevaluasi pemahaman siswa.
- **Crossref Journal Finder**: Mencari referensi dan paper ilmiah acak.
- **Parafrase & Ringkas Teks**: Pengolah teks anti-plagiasi dan pembuat intisari *bullet points*.

### 🏦 5. Sistem Ekonomi, Limit & Top-Up QRIS Dynamic
- **Limit Token Daily & Status Premium**: User gratis mengikuti `JATAH_HARIAN`, sedangkan Premium mendapat **300 token/hari**. Limit direset pukul 00:00 WIB.
- **Satu sistem limit untuk seluruh fitur**: PixAI, AI, akademik, dan fitur berbayar lain menggunakan saldo limit utama, bukan kuota gambar terpisah.
- **QRIS Dynamic Decoder**: Fitur `!topup` yang secara otomatis mengurai QRIS Static DANA menjadi QRIS Dynamic sesuai nominal pesanan token limit.

### ⛏️ 6. Bot Minecraft & Dashboard Web
- **Minecraft/Mineflayer**: Bot dapat terhubung ke server Minecraft remote maupun lokal, dengan dukungan koordinat rumah, radius aman, AuthMe, dan pemilik bot.
- **Pelaporan Minecraft**: Server Minecraft dapat mengirim laporan ke endpoint API bot.
- **Dashboard API**: Menyediakan statistik bot, status provider, kontrol ComfyUI, restart bot, dan helper autentikasi token PixAI.
- **Cloudflared tunnel**: Konfigurasi PM2 tersedia melalui `ecosystem.config.example.js`. File `ecosystem.config.js` lokal sengaja di-ignore karena berisi path/token mesin masing-masing.

### 🛠️ 7. Utilitas Media & Intel
- **Multi-Provider Text-to-Speech (TTS) (`!tts` / `!suara`)**: Mengubah teks menjadi audio/suara jernih via **ArisuSoft API** (*Basic Bahasa Indonesia & Voicevox Anime Jepang*) serta **Cloudflare Workers AI** (*MeloTTS, Deepgram Aura*).
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
   Salin `.env.example` menjadi `.env`, lalu isi API key, token, ID owner, dan konfigurasi layanan yang ingin digunakan. Jangan commit `.env` karena berisi secret.
   ```bash
   cp .env.example .env
   ```

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

6. **Hubungkan WhatsApp (Pairing Code):**
   Bot menggunakan metode login via **Pairing Code** (bukan scan QR). 
   - Pastikan kamu sudah mengisi nomor WA bot di file `.env` pada variabel `WA_PHONE_NUMBER` (Gunakan awalan kode negara, misal: `62812xxx`).
   - Jalankan bot, lalu lihat terminal/console. Bot akan memunculkan 8 digit kode angka.
   - Buka WhatsApp di HP bot > **Perangkat Tertaut (Linked Devices)** > **Tautkan dengan Nomor Telepon (Link with Phone Number)**.
   - Masukkan 8 digit kode angka tersebut ke WhatsApp.

7. **Aktifkan Minecraft (Opsional):**
   Integrasi Minecraft dikendalikan melalui command owner di WhatsApp:
   ```text
   !mc start
   !mc lokal
   !mc status
   !mc chat [pesan]
   !mc stop
   ```
   Isi `MC_HOST`, `MC_PORT`, `MC_USERNAME`, dan konfigurasi terkait di `.env` terlebih dahulu.

8. **Menjalankan Cloudflared dengan PM2 (Opsional):**
   ```bash
   cp ecosystem.config.example.js ecosystem.config.js
   # Sesuaikan path cloudflared.exe dan token-file di ecosystem.config.js
   pm2 start ecosystem.config.js
   pm2 save
   ```
   `ecosystem.config.js` masuk `.gitignore` karena path executable dan token berbeda di setiap mesin.

---

## 🔑 Konfigurasi Environment

Gunakan `.env.example` sebagai template resmi karena file tersebut mengikuti konfigurasi terbaru project:

```bash
cp .env.example .env
```

Kelompok konfigurasi yang tersedia:

- Provider AI: Gemini, OpenRouter, Cloudflare, ArisuSoft, Hugging Face, Ollama, dan xKiro.
- Platform: `DISCORD_TOKEN`, `WA_PHONE_NUMBER`, `ID_OWNER`, dan `LOG_LEVEL`.
- Image rendering: PixAI, Pixiv, ConvertAPI, ComfyUI/Vast.ai, dan CivitAI.
- QRIS: `STATIC_QRIS` untuk fitur top-up.
- Minecraft: host remote/lokal, username, versi, AuthMe, owner, koordinat rumah, dan radius aman.
- Pterodactyl: URL panel, server ID, dan API key jika memakai kontrol server.
- Dashboard/API: `WEB_SECRET_KEY` dan `WEB_SHIROKO_URL` jika memakai dashboard web atau Web Auth Helper.

Untuk rotasi key, beberapa provider menerima beberapa nilai yang dipisahkan koma. Jangan memasukkan token asli ke README, `.env.example`, atau file yang akan di-commit.

### 🌐 API Dashboard dan Webhook

Proses WhatsApp bot juga menjalankan server HTTP pada port `3000` dengan endpoint utama:

- `GET /`: health check sederhana.
- `GET /api/dashboard`: statistik bot dan status layanan.
- `POST /api/control`: kontrol restart bot dan toggle ComfyUI. Membutuhkan header `x-api-key`.
- `POST /laporan-masuk`: menerima laporan dari server Minecraft. Membutuhkan header `x-api-key`.
- `POST /api/save-pixai-token`: menyimpan token PixAI dari Web Auth Helper.
- `POST /api/generate-bookmarklet`: membuat bookmarklet autentikasi PixAI berbasis OTP.

Pastikan `WEB_SECRET_KEY` diisi jika endpoint yang dilindungi digunakan. Jangan membuka endpoint control ke publik tanpa proteksi jaringan/API key yang benar.

---

## 📄 Lisensi & Kontribusi

Dikembangkan untuk kebutuhan pembelajaran dan komunitas. Bebas dikembangkan kembali dengan tetap mencantumkan kredit ke pembuat awal.

> *"Nn... Serahkan urusan taktis ini pada Shiroko, Sensei!"* 🐺
