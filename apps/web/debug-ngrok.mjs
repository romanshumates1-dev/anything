// Debug ngrok HTTPS connection
import http from 'node:http';
import https from 'node:https';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function test() {
  const url = 'https://zit-jawline-cross.ngrok-free.dev/api/sms/inbound';
  console.log('Testing:', url);
  
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    console.log('GET Status:', res.status);
    console.log('Headers:', [...res.headers.entries()]);
  } catch (e) {
    console.log('Error:', e.message, e.cause);
  }
}

test();