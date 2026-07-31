const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE URL or SERVICE ROLE KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupTestUser() {
  const email = 'Bodevilliz@gmail.com';
  const orgId = '00000000-0000-4000-b000-000000000001';

  try {
    console.log("1. Creating user in auth...");
    const { data: userAdminData, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: 'Bode Villiz' }
    });

    let userId;
    if (createError) {
      if (createError.message.includes('already exists') || createError.message.includes('already been registered')) {
        console.log("User already exists, fetching user id...");
        const { data: usersData } = await supabase.auth.admin.listUsers();
        const user = usersData.users.find(u => u.email === email.toLowerCase() || u.email === email);
        if (!user) throw new Error("Could not find user after already exists error.");
        userId = user.id;
      } else {
        throw createError;
      }
    } else {
      userId = userAdminData.user.id;
    }
    console.log(`User ID: ${userId}`);

    console.log("2. Ensuring profile exists (trigger usually does this)...");
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: userId, full_name: 'Bode Villiz', email });
    if (profileError) console.warn("Profile upsert warning (might already exist):", profileError.message);

    console.log("3. Adding user as owner to organisation...");
    const { error: orgError } = await supabase
      .from('organisation_members')
      .upsert({
        organisation_id: orgId,
        profile_id: userId,
        role: 'lead'
      });
      
    if (orgError) throw orgError;
    
    console.log("Success! User Bodevilliz@gmail.com is now an owner of Villiz Pixels.");
  } catch (error) {
    console.error("Error setting up test user:", error);
    process.exit(1);
  }
}

setupTestUser();
