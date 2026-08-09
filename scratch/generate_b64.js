const code = `let t=Object.entries(localStorage).find(([k,v])=>v.includes('eyJ'))?.[1]?.replace(/^"|"$/g,'')||localStorage.getItem('token')||document.cookie;if(t){prompt('Salin Token PixAI Anda (Ctrl+C), lalu paste ke Opsi B:',t);}else{alert('Token tidak ditemukan, pastikan Anda sudah login pada pixai.art');}`;
const b64 = Buffer.from(code).toString('base64');
console.log('javascript:(function(){eval(atob("' + b64 + '"));})()');
