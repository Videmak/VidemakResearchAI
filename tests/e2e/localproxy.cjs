// Serves staging on http://localhost:8080 inside the Playwright container, so pages are a secure
// context (Clipboard API, as on https in production). Run in the background before a test:
//   node localproxy.cjs videmak-router:8080 & sleep 1; BASE=http://localhost:8080 node test.cjs
const net = require('net');
const [host, port] = (process.argv[2] || 'videmak-router:8080').split(':');
net.createServer((client) => {
  const upstream = net.connect(Number(port), host);
  client.pipe(upstream).pipe(client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on('error', close);
  upstream.on('error', close);
}).listen(8080, '127.0.0.1');
