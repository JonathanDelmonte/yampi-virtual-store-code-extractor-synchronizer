import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '../dist');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png'};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/demo.html' : pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}).end(data);
  } catch {res.writeHead(404).end('Arquivo não encontrado.');}
});
server.listen(5181, '127.0.0.1', () => console.log('Demo fictício: http://127.0.0.1:5181/demo.html?demo=1'));
