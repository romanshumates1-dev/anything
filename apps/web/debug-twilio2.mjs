// List all MessagingServices in the Twilio account
async function test() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/MessagingServices.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    console.log(`Status: ${res.status}`);
    const body = await res.text();
    console.log('Response:', body.slice(0, 1000));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test();