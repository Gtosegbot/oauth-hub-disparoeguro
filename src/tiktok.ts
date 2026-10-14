// oauth-hub — TikTok Official Integration Module (Login Kit & Content Posting API)
// Implements independent multi-account TikTok authorization and channel management.

export const TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export const TIKTOK_DEFAULT_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
];

export interface TikTokTokenResult {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  log_id?: string;
}

export interface TikTokUser {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  username?: string;
  is_verified?: boolean;
  profile_deep_link?: string;
}

export interface TikTokCreatorInfo {
  ok: boolean;
  creator_avatar_url?: string;
  creator_nickname?: string;
  creator_username?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
  error?: string;
}

/**
 * Builds the official TikTok Login Kit v2 web authorization URL.
 */
export function buildTikTokAuthUrl(
  clientKey: string,
  redirectUri: string,
  state: string,
  scopes: string[] = TIKTOK_DEFAULT_SCOPES
): string {
  const url = new URL(TIKTOK_AUTH_BASE);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the temporary authorization code for long-lived TikTok access and refresh tokens.
 */
export async function exchangeTikTokCode(
  code: string,
  clientKey: string,
  clientSecret: string,
  redirectUri: string
): Promise<TikTokTokenResult> {
  const endpoint = `${TIKTOK_API_BASE}/oauth/token/`;
  const form = new URLSearchParams();
  form.set("client_key", clientKey);
  form.set("client_secret", clientSecret);
  form.set("code", code);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body: form.toString(),
    });

    const data = (await res.json()) as any;
    if (data.error || !data.access_token) {
      return {
        access_token: "",
        refresh_token: "",
        open_id: "",
        expires_in: 0,
        refresh_expires_in: 0,
        scope: "",
        token_type: "",
        error: data.error || "token_exchange_failed",
        error_description: data.error_description || "Falha na troca de código por token TikTok",
        log_id: data.log_id,
      };
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      open_id: data.open_id,
      expires_in: data.expires_in || 86400,
      refresh_expires_in: data.refresh_expires_in || 31536000,
      scope: data.scope || "",
      token_type: data.token_type || "Bearer",
    };
  } catch (err: any) {
    return {
      access_token: "",
      refresh_token: "",
      open_id: "",
      expires_in: 0,
      refresh_expires_in: 0,
      scope: "",
      token_type: "",
      error: "network_error",
      error_description: err?.message || String(err),
    };
  }
}

/**
 * Refreshes an expired TikTok access token using the long-lived refresh_token.
 */
export async function refreshTikTokToken(
  refreshToken: string,
  clientKey: string,
  clientSecret: string
): Promise<TikTokTokenResult> {
  const endpoint = `${TIKTOK_API_BASE}/oauth/token/`;
  const form = new URLSearchParams();
  form.set("client_key", clientKey);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body: form.toString(),
    });

    const data = (await res.json()) as any;
    if (data.error || !data.access_token) {
      return {
        access_token: "",
        refresh_token: "",
        open_id: "",
        expires_in: 0,
        refresh_expires_in: 0,
        scope: "",
        token_type: "",
        error: data.error || "refresh_failed",
        error_description: data.error_description || "Falha na renovação do token TikTok",
        log_id: data.log_id,
      };
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      open_id: data.open_id,
      expires_in: data.expires_in || 86400,
      refresh_expires_in: data.refresh_expires_in || 31536000,
      scope: data.scope || "",
      token_type: data.token_type || "Bearer",
    };
  } catch (err: any) {
    return {
      access_token: "",
      refresh_token: "",
      open_id: "",
      expires_in: 0,
      refresh_expires_in: 0,
      scope: "",
      token_type: "",
      error: "network_error",
      error_description: err?.message || String(err),
    };
  }
}

/**
 * Retrieves public profile information for the authorized TikTok user.
 */
export async function getTikTokUserInfo(accessToken: string): Promise<{ ok: boolean; user?: TikTokUser; error?: string }> {
  const fields = "open_id,union_id,avatar_url,display_name,username,is_verified,profile_deep_link";
  const url = `${TIKTOK_API_BASE}/user/info/?fields=${fields}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = (await res.json()) as any;
    if (json.error && json.error.code !== "ok" && json.error.code !== 0) {
      return { ok: false, error: json.error.message || `Erro TikTok: ${json.error.code}` };
    }

    const userData = json?.data?.user;
    if (!userData || !userData.open_id) {
      return { ok: false, error: "Perfil do usuário TikTok não retornado" };
    }

    return {
      ok: true,
      user: {
        open_id: userData.open_id,
        union_id: userData.union_id,
        avatar_url: userData.avatar_url,
        display_name: userData.display_name,
        username: userData.username || userData.display_name || `user_${userData.open_id.slice(0, 8)}`,
        is_verified: Boolean(userData.is_verified),
        profile_deep_link: userData.profile_deep_link,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Queries creator publication capabilities via Content Posting API.
 * Identifies if account can publish publicly or is limited to development/private mode.
 */
export async function getTikTokCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const url = `${TIKTOK_API_BASE}/post/publish/creator_info/query/`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({}),
    });

    const json = (await res.json()) as any;
    if (json.error && json.error.code !== "ok" && json.error.code !== 0) {
      return {
        ok: false,
        error: json.error.message || `Creator API code: ${json.error.code}`,
      };
    }

    const data = json?.data;
    if (!data) {
      return { ok: false, error: "Dados do criador vazios" };
    }

    return {
      ok: true,
      creator_avatar_url: data.creator_avatar_url,
      creator_nickname: data.creator_nickname,
      creator_username: data.creator_username,
      privacy_level_options: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
      comment_disabled: Boolean(data.comment_disabled),
      duet_disabled: Boolean(data.duet_disabled),
      stitch_disabled: Boolean(data.stitch_disabled),
      max_video_post_duration_sec: data.max_video_post_duration_sec,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Revokes app access tokens for a TikTok user.
 */
export async function revokeTikTokAccess(
  accessToken: string,
  clientKey: string,
  clientSecret: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `${TIKTOK_API_BASE}/oauth/revoke/`;
  const form = new URLSearchParams();
  form.set("client_key", clientKey);
  form.set("client_secret", clientSecret);
  form.set("token", accessToken);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json = (await res.json()) as any;
    if (json.error && json.error !== "ok") {
      return { ok: false, error: json.error_description || json.error };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Formats display details and status badge metrics for channel health cards in the Hub.
 */
export async function getTikTokChannelDetails(
  accessToken: string,
  canPublish: boolean
): Promise<{ avatar: string; fields: Array<{ k: string; v: string }> }> {
  const out = { avatar: "", fields: [] as Array<{ k: string; v: string }> };
  const userRes = await getTikTokUserInfo(accessToken);
  if (userRes.ok && userRes.user) {
    if (userRes.user.avatar_url) out.avatar = userRes.user.avatar_url;
    if (userRes.user.username) out.fields.push({ k: "username", v: `@${userRes.user.username}` });
    if (userRes.user.display_name) out.fields.push({ k: "name", v: userRes.user.display_name });
  }

  out.fields.push({ k: "quality", v: canPublish ? "Vídeo + Info" : "Info (Dev)" });
  return out;
}
