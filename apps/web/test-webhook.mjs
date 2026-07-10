// Quick webhook test
import http from 'node:http';

async function test() {
  const secret = 'RhT8u5miVLND7Pt3IF9UBKCH2OzGMno6';
  
  const opts = {
    hostname: 'localhost',
    port: 4000,
    path: '/api/sms/inbound',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sms-secret': secret
    }
  };
  
  const req = http.request(opts, (r) => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => console.log('Status:', r.statusCode, 'Response:', d.slice(0, 200)));
  });
  
  req.on('error', e => console.log('Error:', e.message));
  req.write(JSON.stringify({ from: '+15551234567', text: 'test' }));
  req.end();
}

test();