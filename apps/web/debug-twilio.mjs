// Debug Twilio MessagingService endpoint
async function test() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const msgSvcSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  
  console.log('Testing MessagingService endpoint with:');
  console.log('  accountSid:', accountSid);
  console.log('  msgSvcSid:', msgSvcSid);
  
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  // Try different endpoint formats
  const endpoints = [
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/MessagingServices/${msgSvcSid}.json`,
    `https://messaging.twilio.com/v1/Services/${msgSvcSid}`,
  ];
  
  for (const url of endpoints) {
    try {
      console.log(`\nTrying: ${url}`);
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });
      console.log(`Status: ${res.status}`);
      const body = await res.text();
      console.log('Response:', body.slice(0, 200));
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

test();