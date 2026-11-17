import './env.ts';
import { handleRequest } from './http.ts';
import { pollOnce } from './poll.ts';
import { log } from './util.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      log('error', 'request_failed', { message: err instanceof Error ? err.message : 'failed' });
      const wantsJson = new URL(request.url).pathname.startsWith('/api/');
      const body = wantsJson ? JSON.stringify({ error: 'Something went wrong.' }) : 'Something went wrong.';
      return new Response(body, {
        status: 500,
        headers: { 'content-type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' },
      });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await pollOnce(env);
    } catch (err) {
      log('error', 'poll_failed', { message: err instanceof Error ? err.message : 'failed' });
    }
  },
} satisfies ExportedHandler<Env>;
