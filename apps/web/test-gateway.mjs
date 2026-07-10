// Test real outbound send via gateway endpoint
const https = require('https');

const postData = JSON.stringify({
  to: '+15025551234',
  body: 'preflight test outbound'
});

const opts = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/gateway/send',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(opts, (r) => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    console.log('Status:', r.statusCode);
    console.log('Response:', d);
  });
});

req.on('error', e => console.log('Error:', e.message));
req.write(postData);
req.end();