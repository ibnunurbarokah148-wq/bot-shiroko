function getCoreNumber(num) { 
    if (!num) return ''; 
    let base = num.toString().split(':')[0].split('@')[0];
    let n = base.replace(/[^0-9]/g, ''); 
    if (n.startsWith('62')) n = n.substring(2); 
    if (n.startsWith('0')) n = n.substring(1); 
    return n; 
}

module.exports = { getCoreNumber };
