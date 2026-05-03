'use strict';

const http = require('http');
const app = require('./app');
const { PORT } = require('./config');
const { createWsServer } = require('./ws/ws_server');

const httpServer = http.createServer(app);
createWsServer(httpServer);

const HOST = process.env.HOST || '0.0.0.0';
const LOG_HOST = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;

httpServer.listen(PORT, HOST, () => {
  console.log(`✅  Altec Totem Mock API running at http://${LOG_HOST}:${PORT}/v1`);
  console.log(`    WebSocket:  ws://${LOG_HOST}:${PORT}/v1/ws?api_key=ksk_mock_altec_001`);
  console.log(`    API docs:   openapi.yaml`);
  console.log(`    Auth:       Authorization: ApiKey ksk_mock_altec_001`);
});
