import { createServer } from 'node:http';
import dotenv from 'dotenv';
import next from 'next';

// A custom Next entrypoint does not get the CLI's automatic dotenv loading.
// Load local server-only settings before routes initialize their Supabase/AI
// clients; browser bundles never receive these values.
dotenv.config({ path: '.env.local', override: false, quiet: true });
dotenv.config({ path: '.env', override: false, quiet: true });

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.WEIXUN_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '5000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (request, response) => {
    try {
      await handle(request, response);
    } catch (error) {
      console.error('Request handling failed', request.url, error);
      response.statusCode = 500;
      response.end('Internal server error');
    }
  });

  server.once('error', (error) => {
    console.error(`Unable to start server on ${hostname}:${port}`, error);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    console.log(`> Server listening at http://${hostname}:${port} (${dev ? 'development' : 'production'})`);
  });
}).catch((error) => {
  console.error('Unable to prepare the Next application', error);
  process.exit(1);
});
