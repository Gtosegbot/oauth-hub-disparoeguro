// oauth-hub — Meta Ads Official Integration Module (Marketing API & Ad Accounts)
// Implements secure multi-account Meta Ads authorization, ad account listing, campaigns & metrics.

export const DEFAULT_META_API_VERSION = "v21.0";
export const META_AUTH_BASE = "https://www.facebook.com";
export const META_GRAPH_BASE = "https://graph.facebook.com";

// Active read scopes approved for campaign inspection and metrics
export const META_ADS_READ_SCOPES = [
  "ads_read",
  "read_insights",
  "business_management",
];

// Management scopes reserved for active modification (kept disabled until explicit user enablement & review)
export const META_ADS_MANAGE_SCOPES = [
  "ads_management",
];

export interface MetaAdsTokenResult {
  access_token: string;
  token_type: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface MetaAdsUser {
  id: string;
  name: string;
  email?: string;
}

export interface MetaAdAccountSummary {
  id: string;              // e.g. "act_123456789"
  account_id: string;      // raw digits
  name: string;
  account_status: number;  // 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, etc.
  currency: string;
  amount_spent?: string;
  business_name?: string;
  balance?: string;
}

export interface MetaAdsCampaignSummary {
  id: string;
  name: string;
  status: string;          // ACTIVE, PAUSED, ARCHIVED
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export interface MetaAdsInsightsSummary {
  impressions: string;
  clicks: string;
  spend: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
}

/**
 * Builds the official Meta OAuth dialog URL for Meta Ads.
 */
export function buildMetaAdsAuthUrl(
  appId: string,
  redirectUri: string,
  state: string,
  apiVersion = DEFAULT_META_API_VERSION,
  enableManagement = false
): string {
  const scopes = enableManagement
    ? [...META_ADS_READ_SCOPES, ...META_ADS_MANAGE_SCOPES]
    : META_ADS_READ_SCOPES;

  const url = new URL(`${META_AUTH_BASE}/${apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the authorization code for a short-lived access token.
 */
export async function exchangeMetaAdsCode(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
  apiVersion = DEFAULT_META_API_VERSION
): Promise<MetaAdsTokenResult> {
  const url = new URL(`${META_GRAPH_BASE}/${apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    if (data.error || !data.access_token) {
      return {
        access_token: "",
        token_type: "",
        error: data.error?.message || "token_exchange_failed",
        error_description: data.error?.error_user_msg || data.error?.message,
      };
    }
    return {
      access_token: data.access_token,
      token_type: data.token_type || "bearer",
      expires_in: data.expires_in,
    };
  } catch (err: any) {
    return {
      access_token: "",
      token_type: "",
      error: "network_error",
      error_description: err?.message || String(err),
    };
  }
}

/**
 * Exchanges a short-lived token for a 60-day long-lived User token.
 */
export async function getMetaAdsLongLivedToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string,
  apiVersion = DEFAULT_META_API_VERSION
): Promise<MetaAdsTokenResult> {
  const url = new URL(`${META_GRAPH_BASE}/${apiVersion}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    if (data.error || !data.access_token) {
      // Fallback to the short-lived token if exchange fails
      return {
        access_token: shortLivedToken,
        token_type: "bearer",
      };
    }
    return {
      access_token: data.access_token,
      token_type: data.token_type || "bearer",
      expires_in: data.expires_in || 5184000, // 60 days
    };
  } catch {
    return { access_token: shortLivedToken, token_type: "bearer" };
  }
}

/**
 * Fetches basic profile of the authenticated Meta user.
 */
export async function getMetaUser(
  accessToken: string,
  apiVersion = DEFAULT_META_API_VERSION
): Promise<{ ok: boolean; user?: MetaAdsUser; error?: string }> {
  const url = `${META_GRAPH_BASE}/${apiVersion}/me?fields=id,name,email`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as any;
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true, user: { id: data.id, name: data.name, email: data.email } };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Fetches all authorized Ad Accounts for the user.
 */
export async function getMetaAdAccounts(
  accessToken: string,
  apiVersion = DEFAULT_META_API_VERSION
): Promise<{ ok: boolean; accounts: MetaAdAccountSummary[]; error?: string }> {
  const fields = "account_id,name,account_status,currency,amount_spent,business_name,balance";
  const url = `${META_GRAPH_BASE}/${apiVersion}/me/adaccounts?fields=${fields}&limit=50`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as any;
    if (data.error) return { ok: false, accounts: [], error: data.error.message };

    const rawList = Array.isArray(data.data) ? data.data : [];
    const accounts: MetaAdAccountSummary[] = rawList.map((a: any) => ({
      id: a.id?.startsWith("act_") ? a.id : `act_${a.account_id || a.id}`,
      account_id: String(a.account_id || a.id).replace("act_", ""),
      name: a.name || `Conta ${a.account_id || a.id}`,
      account_status: Number(a.account_status ?? 1),
      currency: a.currency || "BRL",
      amount_spent: a.amount_spent ? (Number(a.amount_spent) / 100).toFixed(2) : undefined,
      business_name: a.business_name || undefined,
      balance: a.balance ? (Number(a.balance) / 100).toFixed(2) : undefined,
    }));

    return { ok: true, accounts };
  } catch (err: any) {
    return { ok: false, accounts: [], error: err?.message || String(err) };
  }
}

/**
 * Fetches campaigns for an authorized Ad Account (ads_read).
 */
export async function getMetaAdAccountCampaigns(
  adAccountId: string,
  accessToken: string,
  apiVersion = DEFAULT_META_API_VERSION
): Promise<{ ok: boolean; campaigns: MetaAdsCampaignSummary[]; error?: string }> {
  const cleanId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = "id,name,status,objective,daily_budget,lifetime_budget";
  const url = `${META_GRAPH_BASE}/${apiVersion}/${cleanId}/campaigns?fields=${fields}&limit=25`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as any;
    if (data.error) return { ok: false, campaigns: [], error: data.error.message };

    const raw = Array.isArray(data.data) ? data.data : [];
    const campaigns: MetaAdsCampaignSummary[] = raw.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      daily_budget: c.daily_budget ? (Number(c.daily_budget) / 100).toFixed(2) : undefined,
      lifetime_budget: c.lifetime_budget ? (Number(c.lifetime_budget) / 100).toFixed(2) : undefined,
    }));

    return { ok: true, campaigns };
  } catch (err: any) {
    return { ok: false, campaigns: [], error: err?.message || String(err) };
  }
}

/**
 * Formats channel details for UI rendering without leaking secrets.
 */
export function formatMetaAdsChannelDetails(
  user: MetaAdsUser,
  accounts: MetaAdAccountSummary[],
  canManage = false
): Array<{ k: string; v: string }> {
  const fields: Array<{ k: string; v: string }> = [
    { k: "user", v: user.name || "Usuário Meta" },
    { k: "accounts", v: `${accounts.length} conta(s) autorizada(s)` },
    { k: "permissions", v: canManage ? "ads_read + ads_management" : "ads_read (Leitura e Métricas)" },
  ];

  if (accounts.length > 0) {
    const primary = accounts[0];
    fields.push({ k: "primary_account", v: `${primary.name} (${primary.id})` });
    if (primary.currency) fields.push({ k: "currency", v: primary.currency });
  }

  return fields;
}
