// Production Configuration
// No secrets here - just public URLs

const CONFIG = {
  API_URLS: {
    production: 'https://jarvis-copilot-api.fly.dev',
    local: 'http://localhost:3344',
  },
  DEFAULT_MODE: 'production', // Production defaults to production
};

// Production build always uses production API
async function getApiUrl() {
  return CONFIG.API_URLS.production;
}

// Production build mode is fixed
async function getDevMode() {
  return false;
}

// Environment switching is intentionally disabled
async function setDevMode() {
  return false;
}
