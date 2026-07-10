// Debug ngrok with explicit agent
import https from 'node:https';

async function test() {
  const url = 'zit-jawline-cross.ngrok-free.dev';
  
  return new Promise((resolve) => {
    const opts = {
      hostname: url,
      port: 443,
      path: '/',
      method: 'GET',
      // Use default agent (Node.js 20+ supports HTTPS by default)
    };
    
    console.log('Testing HTTPS connection to:', url);
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