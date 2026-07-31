const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'founder@villiz.com' // One of the seeded emails
  });
  
  if (error) {
    console.error(error);
    return;
  }
  
  const link = data.properties.action_link;
  console.log("Action Link:", link);
  
  // The link usually is: http://localhost:3000/auth/callback?code=...
  // I just need to extract the code and curl localhost:3001
  const url = new URL(link);
  const code = url.searchParams.get('code');
  if (!code) {
    console.log("No code in URL! PKCE might not be enabled or URL is hash based:", link);
    return;
  }
  
  console.log("Extracted code:", code);
  
  const target = `http://localhost:3001/auth/callback?code=${code}&next=/dashboard`;
  console.log("Curling:", target);
  
  const { execSync } = require('child_process');
  try {
    const output = execSync(`curl -s -i "${target}"`).toString();
    console.log("Curl Output:", output);
  } catch (e) {
    console.log("Curl Error:", e.message);
  }
}
run();
