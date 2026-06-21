import base64
import hashlib
import json
import re
import secrets
from urllib.parse import urlencode

import requests

# Constants
CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
AUTH_TOKEN_URL = "https://oauth.secure.pixiv.net/auth/token"

USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)"

def generate_code_verifier():
    return secrets.token_urlsafe(32)

def generate_code_challenge(code_verifier):
    code_challenge = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(code_challenge).decode("ascii")
    return code_challenge.rstrip("=")

def login():
    code_verifier = generate_code_verifier()
    code_challenge = generate_code_challenge(code_verifier)

    login_params = {
        "client": "pixiv-android",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    
    # Cetak URL untuk dibuka secara manual oleh Sensei
    print("=========================================")
    print("1. Buka URL ini di browser (Chrome/Edge):")
    print(f"{LOGIN_URL}?{urlencode(login_params)}")
    print("=========================================")
    print("2. Tekan F12, ke tab Network, centang 'Preserve log', ketik filter: callback?")
    print("3. Login ke Pixiv.")
    print("4. Layar akan menjadi blank. Cek tab Network, temukan URL yang mengandung 'code='")
    print("5. Salin teks kode tersebut (setelah tulisan code=) dan tempel di bawah ini.")
    print("=========================================\n")

    code = input("Masukkan code: ").strip()

    response = requests.post(
        AUTH_TOKEN_URL,
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code": code,
            "code_verifier": code_verifier,
            "grant_type": "authorization_code",
            "include_policy": "true",
            "redirect_uri": REDIRECT_URI,
        },
        headers={"User-Agent": USER_AGENT},
    )
    
    data = response.json()
    if "access_token" in data:
        print("\n✅ OPERASI SUKSES! INI REFRESH TOKEN SENSEI:")
        print("=========================================")
        print(data["refresh_token"])
        print("=========================================")
        print("Salin Refresh Token di atas dan masukkan ke dalam file index.js Sensei.")
    else:
        print("\n❌ GAGAL. Error dari Pixiv:")
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    login()