/**
 * Validation rules that match server-side requirements
 * Validates names BEFORE attempting to sync to prevent failures
 */

// Reserved words from hyperclay server
// Words that cannot be included in any part of the name
const cantInclude = [
  "account",
  "admin",
  "billing",
  "folder",
  "help",
  "hyperclay",
  "identi",
  "moderator",
  "owner",
  "password",
  "payment",
  "root",
  "securit",
  "server",
  "settings",
  "system",
  "user",
];

// Words that the name cannot be exactly equal to
const cantBeEqualTo = [
  "_acme-challenge",
  "_atproto",
  "about",
  "access",
  "activate",
  "alert",
  "analytics",
  "api",
  "app",
  "apps",
  "archive",
  "archives",
  "article",
  "asset",
  "assets",
  "assist",
  "assistance",
  "auth",
  "authentication",
  "author",
  "avatar",
  "backup",
  "backups",
  "billing",
  "blog",
  "blogs",
  "board",
  "bot",
  "bots",
  "business",
  "cache",
  "calendar",
  "call",
  "callback",
  "campaign",
  "captcha",
  "career",
  "careers",
  "cart",
  "categories",
  "category",
  "cgi",
  "cgi-bin",
  "changelog",
  "chat",
  "check",
  "checking",
  "checkout",
  "client",
  "cliente",
  "clients",
  "code",
  "codemirror",
  "common",
  "communities",
  "community",
  "company",
  "component",
  "components",
  "compose",
  "config",
  "configuration",
  "connect",
  "contact",
  "contact-form",
  "contact_form",
  "contact-us",
  "contact_us",
  "contactform",
  "contactus",
  "content",
  "contest",
  "contract",
  "contribute",
  "control",
  "controller",
  "convert",
  "copy",
  "corp",
  "create",
  "css",
  "dashboard",
  "data",
  "database",
  "date",
  "db",
  "default",
  "delete",
  "demo",
  "describe",
  "design",
  "designer",
  "destroy",
  "detail",
  "dev",
  "developer",
  "developers",
  "diagram",
  "dict",
  "dictionary",
  "die",
  "digital",
  "dir",
  "direct",
  "direct-message",
  "direct-messages",
  "direct_message",
  "direct_messages",
  "directory",
  "disable",
  "discover",
  "display",
  "dist",
  "doc",
  "docs",
  "document",
  "documentation",
  "domain",
  "download",
  "downloads",
  "drop",
  "dropbox",
  "ecommerce",
  "edit",
  "editor",
  "edu",
  "education",
  "element",
  "email",
  "employment",
  "en",
  "enable",
  "end",
  "endpoint",
  "enterprise",
  "entries",
  "entry",
  "error",
  "errors",
  "eval",
  "event",
  "events",
  "example",
  "exist",
  "exit",
  "explain",
  "explore",
  "export",
  "extend",
  "facebook",
  "faq",
  "favorite",
  "favorites",
  "feature",
  "features",
  "feed",
  "feedback",
  "feeds",
  "field",
  "file",
  "files",
  "find",
  "follow",
  "followers",
  "following",
  "forget-password",
  "forget_password",
  "forgot",
  "forgot-password",
  "forgot_password",
  "form",
  "forum",
  "forums",
  "friend",
  "friends",
  "ftp",
  "generate",
  "get",
  "group",
  "groups",
  "guest",
  "guests",
  "handle",
  "handler",
  "help",
  "helper",
  "hidden",
  "home",
  "homepage",
  "host",
  "hosting",
  "hostmaster",
  "hostname",
  "how",
  "howto",
  "html",
  "http",
  "httpd",
  "https",
  "hyper",
  "hyperclay",
  "icon",
  "icons",
  "id",
  "image",
  "images",
  "imap",
  "img",
  "important",
  "index",
  "info",
  "information",
  "input",
  "inquiry",
  "instagram",
  "intranet",
  "invalid",
  "invalid-email",
  "invalid_email",
  "invitations",
  "invite",
  "ipad",
  "iphone",
  "irc",
  "issue",
  "issues",
  "it",
  "item",
  "items",
  "java",
  "javascript",
  "job",
  "jobs",
  "join",
  "js",
  "json",
  "knowledge",
  "knowledgebase",
  "landing",
  "landing-page",
  "landing_page",
  "legal",
  "license",
  "list",
  "lists",
  "load",
  "local",
  "log",
  "log-in",
  "log-out",
  "log_in",
  "log_out",
  "login",
  "logout",
  "logs",
  "m",
  "mac",
  "mail",
  "mail1",
  "mail2",
  "mail3",
  "mail4",
  "mail5",
  "mailer",
  "mailing",
  "maintenance",
  "manager",
  "manual",
  "map",
  "maps",
  "marketing",
  "master",
  "me",
  "media",
  "member",
  "members",
  "message",
  "messages",
  "messenger",
  "method",
  "microblog",
  "microblogs",
  "mine",
  "mobile",
  "movie",
  "movies",
  "mp3",
  "msg",
  "msn",
  "music",
  "musicas",
  "mx",
  "my",
  "mysql",
  "name",
  "named",
  "nav",
  "navigation",
  "net",
  "network",
  "new",
  "news",
  "newsletter",
  "nick",
  "nickname",
  "notes",
  "notice",
  "noticias",
  "notification",
  "notifications",
  "notify",
  "ns",
  "ns1",
  "ns10",
  "ns2",
  "ns3",
  "ns4",
  "ns5",
  "ns6",
  "ns7",
  "ns8",
  "ns9",
  "null",
  "oauth",
  "oauth_clients",
  "object",
  "offer",
  "offers",
  "official",
  "online",
  "openid",
  "operator",
  "order",
  "orders",
  "organization",
  "organizations",
  "output",
  "overview",
  "owner",
  "owners",
  "pack",
  "page",
  "pager",
  "pages",
  "panel",
  "param",
  "parameter",
  "parameters",
  "parse",
  "password",
  "pattern",
  "pay",
  "payment",
  "perl",
  "phone",
  "photo",
  "photoalbum",
  "photos",
  "php",
  "phpmyadmin",
  "phppgadmin",
  "phpredisadmin",
  "pic",
  "pics",
  "ping",
  "plan",
  "plans",
  "platform",
  "plugin",
  "plugins",
  "policy",
  "pm-bounces",
  "pop",
  "pop3",
  "popular",
  "portal",
  "post",
  "postfix",
  "postmaster",
  "posts",
  "premium",
  "press",
  "preview",
  "price",
  "pricing",
  "privacy",
  "privacy-policy",
  "privacy_policy",
  "privacypolicy",
  "private",
  "process",
  "product",
  "products",
  "profile",
  "progress",
  "project",
  "projects",
  "promo",
  "pub",
  "public",
  "publish",
  "purpose",
  "put",
  "python",
  "query",
  "random",
  "ranking",
  "read",
  "readme",
  "recent",
  "record",
  "recruit",
  "recruitment",
  "reference",
  "register",
  "registration",
  "release",
  "remove",
  "rename",
  "replies",
  "report",
  "report-site",
  "report_sites",
  "reports",
  "repositories",
  "repository",
  "req",
  "request",
  "requests",
  "require",
  "reset",
  "reset-password",
  "reset_password",
  "resource",
  "respond",
  "response",
  "restore",
  "result",
  "return",
  "review",
  "root",
  "route",
  "rss",
  "ruby",
  "rule",
  "sale",
  "sales",
  "sample",
  "samples",
  "save",
  "schedule",
  "schema",
  "school",
  "scope",
  "script",
  "scripts",
  "search",
  "secret",
  "secret-signup",
  "secret_signup",
  "secure",
  "self",
  "sell",
  "send",
  "server",
  "server-info",
  "server-status",
  "server_info",
  "server_status",
  "service",
  "services",
  "session",
  "sessions",
  "set",
  "setting",
  "settings",
  "setup",
  "share",
  "shop",
  "shops",
  "show",
  "sign",
  "sign-in",
  "sign-up",
  "sign_in",
  "sign_up",
  "signal",
  "signin",
  "signout",
  "signup",
  "site",
  "sitemap",
  "sites",
  "smartphone",
  "smtp",
  "sound",
  "source",
  "spec",
  "special",
  "sql",
  "src",
  "ssh",
  "ssl",
  "ssladmin",
  "ssladministrator",
  "sslwebmaster",
  "staff",
  "stage",
  "staging",
  "start",
  "stat",
  "state",
  "static",
  "stats",
  "status",
  "store",
  "stores",
  "stories",
  "style",
  "styleguide",
  "styles",
  "stylesheet",
  "stylesheets",
  "subdomain",
  "submit",
  "subscribe",
  "subscriptions",
  "success",
  "support",
  "supports",
  "svn",
  "switch",
  "sys",
  "sysadmin",
  "sysadministrator",
  "system",
  "table",
  "tablet",
  "tablets",
  "tag",
  "talk",
  "target",
  "task",
  "tasks",
  "team",
  "teams",
  "tech",
  "telnet",
  "temp",
  "template",
  "term",
  "terms",
  "terms-of-service",
  "terms_of_service",
  "termsofservice",
  "tests",
  "thank-you",
  "thank_you",
  "thanks",
  "theme",
  "themes",
  "thread",
  "threads",
  "title",
  "tmp",
  "todo",
  "tool",
  "tools",
  "top",
  "topic",
  "topics",
  "tos",
  "translation",
  "translations",
  "trends",
  "trigger",
  "tutorial",
  "tv",
  "twitter",
  "type",
  "undefined",
  "unfollow",
  "unsubscribe",
  "update",
  "upgrade",
  "upload",
  "uploads",
  "url",
  "usage",
  "use",
  "user",
  "username",
  "users",
  "usuario",
  "util",
  "value",
  "vendas",
  "ver",
  "version",
  "video",
  "videos",
  "view",
  "visit",
  "visitor",
  "warn",
  "watch",
  "we-will-be-in-touch",
  "we_will_be_in_touch",
  "weather",
  "web",
  "webhook",
  "webhooks",
  "webmail",
  "webmaster",
  "website",
  "websites",
  "welcome",
  "widget",
  "widgets",
  "wiki",
  "windows",
  "word",
  "work",
  "works",
  "workshop",
  "write",
  "ww",
  "wws",
  "www",
  "www1",
  "www2",
  "www3",
  "www4",
  "www5",
  "www6",
  "www7",
  "wwws",
  "wwww",
  "wwwww",
  "xfn",
  "xml",
  "xmpp",
  "xpg",
  "xxx",
  "yaml",
  "year",
  "yml",
  "you",
  "yourdomain",
  "yourname",
  "yoursite",
  "yourusername",
  "zone",
];

/**
 * Validate folder name
 * Must be lowercase letters, numbers, underscore, hyphen only
 */
function validateFolderName(name) {
  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'Folder name cannot be empty'
    };
  }

  // Check for invalid characters
  if (!name.match(/^[a-z0-9_-]+$/)) {
    return {
      valid: false,
      error: 'Folder names can only contain lowercase letters, numbers, hyphens and underscores'
    };
  }

  // Check length
  if (name.length > 255) {
    return {
      valid: false,
      error: 'Folder name is too long (max 255 characters)'
    };
  }

  return { valid: true };
}

/**
 * Validate site name
 * Must follow hyperclay rules for site names
 */
function validateSiteName(name) {
  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'Site name cannot be empty'
    };
  }

  // Strip .html extension if present (we add it back later)
  const baseName = name.replace(/\.html$/i, '');

  // Check length
  if (baseName.length < 1) {
    return {
      valid: false,
      error: 'Site name is too short'
    };
  }
  if (baseName.length > 63) {
    return {
      valid: false,
      error: 'Site name is too long (max 63 characters)'
    };
  }

  // Check format - only letters, numbers, and hyphens
  if (!baseName.match(/^[a-zA-Z0-9-]+$/)) {
    return {
      valid: false,
      error: 'Site name can only contain letters (A-Z), numbers (0-9), and hyphens (-)'
    };
  }

  // Cannot start or end with hyphen
  if (baseName.startsWith('-') || baseName.endsWith('-')) {
    return {
      valid: false,
      error: 'Site name cannot start or end with a hyphen'
    };
  }

  // Check for consecutive hyphens
  if (baseName.includes('--')) {
    return {
      valid: false,
      error: 'Site name cannot contain consecutive hyphens'
    };
  }

  // Check reserved words using the same logic as hyperclay server
  const lowerName = baseName.toLowerCase();

  // Check if name includes any of the cantInclude words
  const invalidInclude = cantInclude.some(word => lowerName.includes(word));
  if (invalidInclude) {
    return {
      valid: false,
      error: `"${baseName}" is reserved and cannot be used as a site name`
    };
  }

  // Check if name is exactly equal to any of the cantBeEqualTo words
  if (cantBeEqualTo.includes(lowerName)) {
    return {
      valid: false,
      error: `"${baseName}" is reserved and cannot be used as a site name`
    };
  }

  return { valid: true };
}

/**
 * Validate upload/file name
 * More permissive than sites/folders but still has restrictions
 * NOTE: This is a placeholder for future upload sync support
 */
function validateUploadName(name) {
  // For now, we don't sync uploads, so this is just a placeholder
  // that shows the structure for when we do implement it

  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'File name cannot be empty'
    };
  }

  // Check length (byte length for UTF-8)
  const byteLength = Buffer.from(name).length;
  if (byteLength > 255) {
    return {
      valid: false,
      error: 'File name is too long'
    };
  }

  // Prevent leading/trailing dots
  if (name.startsWith('.') || name.endsWith('.')) {
    return {
      valid: false,
      error: 'File name cannot start or end with a dot'
    };
  }

  // Prevent control characters and problematic chars
  // Blocks: Control chars, /, \, <, >, :, ", |, ?, *, null byte
  if (/[\x00-\x1F\x7F\/\\<>:"|?*\u0000]/u.test(name)) {
    return {
      valid: false,
      error: 'File name contains invalid characters'
    };
  }

  // Check for Windows reserved names
  const lowerName = name.toLowerCase();
  const baseName = lowerName.split('.')[0];
  const problematicNames = [
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
  ];

  if (problematicNames.includes(baseName)) {
    return {
      valid: false,
      error: 'This file name is reserved by the system'
    };
  }

  // For now, since we don't sync uploads, always return valid
  // This structure is here for future implementation
  return { valid: true };
}

/**
 * Determine file type from filename/path
 */
function getFileType(filename, isDirectory = false) {
  if (isDirectory) {
    return 'folder';
  }

  // Sites have .html extension
  if (filename.endsWith('.html')) {
    return 'site';
  }

  // Everything else would be an upload (when we support them)
  return 'upload';
}

/**
 * Main validation function
 * Returns { valid: boolean, error?: string, type: string }
 */
function validateFileName(filename, isDirectory = false) {
  const type = getFileType(filename, isDirectory);

  // Remove .html extension for site validation
  const nameToValidate = type === 'site'
    ? filename.replace(/\.html$/i, '')
    : filename;

  let result;
  switch (type) {
    case 'folder':
      result = validateFolderName(nameToValidate);
      break;
    case 'site':
      result = validateSiteName(nameToValidate);
      break;
    case 'upload':
      result = validateUploadName(nameToValidate);
      break;
    default:
      result = { valid: false, error: 'Unknown file type' };
  }

  return { ...result, type };
}

/**
 * Validate a full path (folder/folder/file.html)
 */
function validateFullPath(fullPath) {
  const parts = fullPath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, error: 'Empty path' };
  }

  // Check folder depth (parts.length - 1 because last part is filename)
  const folderDepth = parts.length - 1;
  if (folderDepth > 5) {
    return {
      valid: false,
      error: 'Folder depth cannot exceed 5 levels. Please reorganize your files into a shallower structure.'
    };
  }

  // Validate each folder in the path
  for (let i = 0; i < parts.length - 1; i++) {
    const folderResult = validateFolderName(parts[i]);
    if (!folderResult.valid) {
      return {
        valid: false,
        error: `Invalid folder "${parts[i]}": ${folderResult.error}`
      };
    }
  }

  // Validate the filename (last part)
  const filename = parts[parts.length - 1];
  const isDirectory = !filename.includes('.');
  const fileResult = validateFileName(filename, isDirectory);

  if (!fileResult.valid) {
    return {
      valid: false,
      error: `Invalid ${fileResult.type} name "${filename}": ${fileResult.error}`
    };
  }

  return { valid: true, type: fileResult.type };
}

module.exports = {
  validateFileName,
  validateFolderName,
  validateSiteName,
  validateUploadName,
  validateFullPath,
  getFileType,
  cantInclude,
  cantBeEqualTo
};