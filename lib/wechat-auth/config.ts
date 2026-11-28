export function wechatLoginEnabled() {
  return process.env.WECHAT_LOGIN_ENABLED === "true"
    && /^wx[a-f0-9]{16}$/i.test(process.env.WECHAT_APP_ID || "")
    && /^[a-f0-9]{32}$/i.test(process.env.WECHAT_APP_SECRET || "")
    && (process.env.WECHAT_OAUTH_CLIENT_SECRET || "").length >= 43
    && (process.env.WECHAT_OAUTH_SUBJECT_KEY || "").length >= 43;
}
