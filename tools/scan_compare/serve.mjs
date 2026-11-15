import http from 'node:http'; import { readFileSync, writeFileSync } from 'node:fs'; import { spawn } from 'node:child_process';
const scan = readFileSync('../../shaders/scan.frag', 'utf8');
let done;
const finished = new Promise(r => done = r);
const srv = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const f = req.url === '/scan.frag' ? scan : req.url === '/in.f16' ? readFileSync('in.f16') : req.url === '/' ? readFileSync('harness.html') : '';
    res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html' : 'application/octet-stream' }); res.end(f); return;
  }
  let body = ''; req.on('data', d => body += d); req.on('end', () => { res.end('ok'); if (req.url === '/result') { writeFileSync('web.json', body); done(); } else console.log('page:', body); });
}).listen(0, async () => {
  const port = srv.address().port;
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--user-data-dir=/tmp/scanweb-chrome', `http://localhost:${port}/`], { stdio: 'ignore' });
  await Promise.race([finished, new Promise(r => setTimeout(r, 60000))]);
  chrome.kill(); srv.close();
  const j = JSON.parse(readFileSync('web.json', 'utf8')); console.log(j.error ?? `web upscaled ${j.w}x${j.h} err ${j.err}`);
  process.exit(0);
});
