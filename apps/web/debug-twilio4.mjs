// Debug Twilio auth
async function test() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  console.log('Auth header:', `Basic ${auth.slice(0, 20)}...`);
  
  // Try account fetch
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    console.log(`Account fetch status: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      console.log('Account name:', data.friendly_name);
    }
  } catch (e) {
    console.log('Account error:', e.message);
  }
  
  // Try phone numbers with encoded auth
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
      headers: { 
        Authorization: `Basic ${auth}`,
        'Accept': 'application/json'
      },
    });
    console.log(`\nPhone numbers status: ${res.status}`);
    const body = await res.text();
    console.log('Response:', body.slice(0, 500));
  } catch (e) {
    console.log('Phone numbers error:', e.message);
  }
}

test();