export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  openNotebookUrl: process.env.OPEN_NOTEBOOK_URL ?? "",
  openNotebookPassword: process.env.OPEN_NOTEBOOK_PASSWORD ?? "",
  vaultQwenModel: process.env.OPEN_NOTEBOOK_VAULT_QWEN_MODEL ?? "",
  vaultServiceKey: process.env.OPEN_NOTEBOOK_VAULT_SERVICE_KEY ?? "",
  vaultSourceAllowlist: (process.env.OPEN_NOTEBOOK_VAULT_SOURCE_ALLOWLIST ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
};

export function isVaultEnabled() {
  return process.env.OPEN_NOTEBOOK_VAULT_ENABLED === "true" &&
    Boolean(
      process.env.OPEN_NOTEBOOK_URL &&
      process.env.OPEN_NOTEBOOK_PASSWORD &&
      process.env.OPEN_NOTEBOOK_VAULT_QWEN_MODEL &&
      process.env.OPEN_NOTEBOOK_VAULT_SERVICE_KEY &&
      ENV.vaultSourceAllowlist.length,
    );
}
