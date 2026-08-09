const rawCode = `let t=Object.entries(localStorage).find(([k,v])=>v.includes('eyJ'))?.[1]?.replace(/^"|"$/g,'')||localStorage.getItem('token')||document.cookie;if(t){prompt('Salin Token PixAI Anda (Ctrl+C), lalu paste ke Opsi B:',t);}else{alert('Token tidak ditemukan, pastikan Anda sudah login pada pixai.art');}`;
const salt = 15;
const arrayStr = Array.from(rawCode).map(c => c.charCodeAt(0) + salt).join(',');
const randVar = 'v_' + Math.random().toString(36).substring(2, 8);
const bookmarkletPayload = `javascript:(function(){var ${randVar}=[${arrayStr}];eval(String.fromCharCode.apply(null,${randVar}.map(function(c){return c-${salt}})));})()`;
console.log("PAYLOAD:");
console.log(bookmarkletPayload);

// Simulate execution
try {
    const executed = String.fromCharCode.apply(null, arrayStr.split(',').map(c => parseInt(c) - salt));
    console.log("\nDECODED CODE MATCHES RAW CODE?", executed === rawCode);
    console.log(executed);
} catch (e) {
    console.error(e);
}
