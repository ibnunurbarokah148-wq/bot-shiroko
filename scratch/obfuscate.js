function toHex(str) {
    return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

const encodedTokenStr = toHex('token');
const encodedEyJ = toHex('eyJ');
const encodedPromptStr = toHex('Salin Token PixAI Anda (Ctrl+C), lalu paste ke Opsi B:');
const encodedAlertStr = toHex('Token tidak ditemukan, pastikan Anda sudah login pada pixai.art');

const code = `
javascript:(function(){
    let _0x1a=Object['${toHex('entries')}'](window['${toHex('localStorage')}'])['${toHex('find')}'](
        ([_0x1b,_0x1c]) => _0x1c['${toHex('includes')}']('${encodedEyJ}')
    )?.[1]?.['${toHex('replace')}'](/^"|"$/g,'') 
    || window['${toHex('localStorage')}']['${toHex('getItem')}']('${encodedTokenStr}') 
    || document['${toHex('cookie')}'];
    
    if(_0x1a){
        window['${toHex('prompt')}']('${encodedPromptStr}',_0x1a);
    } else {
        window['${toHex('alert')}']('${encodedAlertStr}');
    }
})()
`.replace(/\s+/g, '');

console.log(code);
