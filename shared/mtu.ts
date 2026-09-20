export const CONVO_TEST_LOGIN_EMAIL = "ajewoletimothymtu@gmail.com";

export function isMtuEmail(email: string) {
  return /^[^\s@]+@mtu\.edu\.ng$/i.test(email.trim());
}

export function isAllowedConvoLoginEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return isMtuEmail(normalized) || normalized === CONVO_TEST_LOGIN_EMAIL;
}
