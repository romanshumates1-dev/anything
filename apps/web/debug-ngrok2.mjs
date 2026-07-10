// Debug ngrok HTTPS with native https module
import https from 'node:https';

async function test() {
  const url = 'zit-jawline-cross.ngrok-free.dev';
  const path = '/api/sms/inbound';
  
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url,
      port: 443,
      path: path,
      method: 'GET',
      headers: { 'Host': url }
    };
    
    const req = https.request(opts, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        console.log('Status:', r.statusCode);
        console.log('Response:', d.slice(0, 300));
        resolve(r.statusCode);
      });
    });
    
    req.on('error', e => {
      console.log('Error:', e.message);
      console.log('Code:', e.code);
      resolve(null);
    });
    
    req.end();
  });
}

test();