// utils/categories.js
// All entries are parent domains. Subdomain matching is via endsWith.

export const PRODUCTIVITY_DOMAINS = new Set([
  "github.com",
  "gitlab.com",
  "google.com",
  "atlassian.com",
  "notion.so",
  "linear.app",
  "figma.com",
  "stackoverflow.com",
  "mozilla.org",
  "vercel.com",
  "netlify.com",
  "railway.app",
  "slack.com",
  "zoom.us",
  "trello.com",
  "asana.com",
  "vscode.dev",
  "codesandbox.io",
  "replit.com"
]);

export const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "threads.net",
  "twitter.com",
  "x.com",
  "reddit.com",
  "tiktok.com",
  "youtube.com",
  "twitch.tv",
  "snapchat.com",
  "linkedin.com",
  "pinterest.com",
  "tumblr.com"
]);

function matchesDomainSet(domain, domainSet) {
  for (const entry of domainSet) {
    if (domain === entry || domain.endsWith("." + entry)) {
      return true;
    }
  }
  return false;
}

export function categorizeDomain(domain) {
  if (!domain) {
    return "other";
  }

  const normalized = domain.toLowerCase().replace(/^www\./, "");

  if (matchesDomainSet(normalized, PRODUCTIVITY_DOMAINS)) {
    return "productivity";
  }

  if (matchesDomainSet(normalized, SOCIAL_DOMAINS)) {
    return "social";
  }

  return "other";
}
