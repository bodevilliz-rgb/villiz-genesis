const { execSync } = require('child_process');
const http = require('http');

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

function runCmd(command) {
  return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (err) => reject(err));
    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    }
  });
}

async function main() {
  console.log(blue("=== Running Local Preview Environment Smoke Checks ==="));
  let failed = false;

  // 1. Verify Next.js responds on port 3001
  try {
    const res = await fetchUrl('http://localhost:3001/login', { timeout: 3000 });
    if (res.statusCode === 200) {
      console.log(green("✔ Next.js is responding on port 3001."));
    } else {
      console.error(red(`✘ Next.js on port 3001 returned status ${res.statusCode}.`));
      failed = true;
    }
  } catch (err) {
    console.error(red("✘ Next.js is not responding on port 3001:"), err.message);
    failed = true;
  }

  // 2. Verify local Supabase responds
  try {
    const res = await fetchUrl('http://127.0.0.1:54321/rest/v1/', { timeout: 3000 });
    // Supabase REST endpoint without authorization returns a 400 or 200 config JSON depending on setup.
    // If it responds at all (even with HTTP 400 or 401), the service is online.
    if (res.statusCode) {
      console.log(green("✔ Local Supabase API gateway is online on port 54321."));
    } else {
      console.error(red(`✘ Local Supabase responded with invalid status ${res.statusCode}.`));
      failed = true;
    }
  } catch (err) {
    console.error(red("✘ Local Supabase is not responding on port 54321:"), err.message);
    failed = true;
  }

  // 3. Verify CSS stylesheet responds with status 200 and has known Villiz classes
  try {
    const loginPage = await fetchUrl('http://localhost:3001/login', { timeout: 3000 });
    const cssMatch = loginPage.body.match(/href="(\/_next\/static\/css\/app\/layout\.css\?v=[0-9]+)"/);
    if (!cssMatch) {
      console.error(red("✘ Could not find layout.css link in login page HTML."));
      failed = true;
    } else {
      const cssPath = cssMatch[1];
      const cssUrl = `http://localhost:3001${cssPath}`;
      const cssRes = await fetchUrl(cssUrl, { timeout: 3000 });
      if (cssRes.statusCode === 200) {
        console.log(green("✔ Compiled CSS stylesheet loaded successfully."));
        
        // CSS smoke check for known Villiz design tokens
        const hasBackgroundToken = cssRes.body.includes('--background: #080808') || cssRes.body.includes('--background:#080808');
        const hasPrimaryToken = cssRes.body.includes('--primary: #ff6a00') || cssRes.body.includes('--primary:#ff6a00');
        const hasTailwindRule = cssRes.body.includes('background-color') && cssRes.body.includes('var(--background)');
        
        if (hasBackgroundToken && hasPrimaryToken && hasTailwindRule) {
          console.log(green("✔ CSS smoke check passed: Tailwind V4 is compiled with Villiz design system tokens."));
        } else {
          console.error(red("✘ CSS smoke check failed: Compiled stylesheet is missing expected Villiz layout rules or custom color variables."));
          failed = true;
        }
      } else {
        console.error(red(`✘ Stylesheet URL ${cssUrl} returned HTTP ${cssRes.statusCode}.`));
        failed = true;
      }
    }
  } catch (err) {
    console.error(red("✘ CSS stylesheet check failed:"), err.message);
    failed = true;
  }

  // 4. Verify login page responds with correct content
  try {
    const res = await fetchUrl('http://localhost:3001/login', { timeout: 3000 });
    if (res.body.includes("Villiz Social Manager") && res.body.includes("Email me a sign-in link")) {
      console.log(green("✔ Login page renders correct UI elements."));
    } else {
      console.error(red("✘ Login page is rendering, but missing expected Villiz branding text or LoginForm."));
      failed = true;
    }
  } catch (err) {
    failed = true;
  }

  // 5. Verify dashboard route is protected when signed out
  try {
    const res = await fetchUrl('http://localhost:3001/dashboard', { timeout: 3000 });
    // Next.js middleware returns a 307 redirect to /login
    if (res.statusCode === 307 || res.headers.location === '/login' || res.body.includes('NEXT_REDIRECT') || res.headers.location?.includes('/login')) {
      console.log(green("✔ Dashboard route is correctly protected (redirects signed-out users)."));
    } else {
      console.error(red(`✘ Security check failed: /dashboard did not redirect signed-out user (returned HTTP ${res.statusCode}).`));
      failed = true;
    }
  } catch (err) {
    console.error(red("✘ Dashboard route protection check failed:"), err.message);
    failed = true;
  }

  // 6. Verify seeded organisation exists in the database
  try {
    const queryRes = runCmd(`npx supabase db query "select name from public.organisations where id = '00000000-0000-4000-b000-000000000001'"`);
    if (queryRes.includes("Villiz Pixels")) {
      console.log(green("✔ Seeded Organisation 'Villiz Pixels' exists in local database."));
    } else {
      console.error(red("✘ Seeded Organisation 'Villiz Pixels' was not found in the database."));
      failed = true;
    }
  } catch (err) {
    console.error(red("✘ Database query for Organisation failed:"), err.message);
    failed = true;
  }

  // 7. Verify seeded staff membership exists in the database
  try {
    const queryRes = runCmd(`npx supabase db query "select role from public.organisation_members where organisation_id = '00000000-0000-4000-b000-000000000001' and profile_id = '0eea9074-18f3-4934-9e20-b2bfde1fef05'"`);
    if (queryRes.includes("lead")) {
      console.log(green("✔ Seeded Staff Membership exists with role 'lead'."));
    } else {
      console.error(red("✘ Seeded Staff Membership 'Bodevilliz@gmail.com' was not found or role is incorrect."));
      failed = true;
    }
  } catch (err) {
    console.error(red("✘ Database query for Membership failed:"), err.message);
    failed = true;
  }

  if (failed) {
    console.log(red("\n=== Smoke Checks FAILED ==="));
    process.exit(1);
  } else {
    console.log(green("\n=== All Smoke Checks PASSED ==="));
    process.exit(0);
  }
}

main();
