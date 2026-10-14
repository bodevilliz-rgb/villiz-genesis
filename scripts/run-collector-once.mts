import { collectEngagementAnalytics } from "../src/core/application/use-cases/engagement/collector";
import { HttpBlotatoClient } from "../src/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "../src/infrastructure/blotato/blotato-config";
import { SupabaseEngagementRepository } from "../src/infrastructure/repositories/supabase-engagement-repository";
import { SupabasePublishingRepository } from "../src/infrastructure/repositories/supabase-publishing-repository";
import { createAdminClient } from "../src/infrastructure/supabase/admin-client";

const admin = createAdminClient();
const result = await collectEngagementAnalytics({
  publishing: new SupabasePublishingRepository(admin),
  engagement: new SupabaseEngagementRepository(admin),
  blotatoClient: new HttpBlotatoClient(blotatoConfig().apiKey),
}, { limit: 50 });
console.log(JSON.stringify(result, null, 1));