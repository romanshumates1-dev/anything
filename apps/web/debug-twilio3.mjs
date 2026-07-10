// List all phone numbers in the Twilio account
async function test() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    console.log(`Status: ${res.status}`);
    const body = await res.text();
    console.log('Response:', body.slice(0, 2000));
    
    // Also try to check what phone numbers exist
    const data = JSON.parse(body);
    if (data.incoming_phone_numbers) {
      console.log('\nPhone numbers:');
      data.incoming_phone_numbers.forEach(p => {
        console.log(`  ${p.phone_number} - SMS URL: ${p.sms_url || '(not set)'}`);
      });
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test();