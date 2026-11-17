// Secrets are set with `wrangler secret put` and are not declared in wrangler.jsonc.
// Augmenting the generated Env keeps the D1 and asset bindings in one place.
declare global {
  interface Env {
    ADMIN_TOKEN?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    TURNSTILE_SECRET?: string;
  }
}

export {};
