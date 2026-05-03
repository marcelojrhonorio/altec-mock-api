'use strict';

const http = require('http');
const app = require('./app');
const { PORT } = require('./config');
const { createWsServer } = require('./ws/ws_server');

const httpServer = http.createServer(app);
createWsServer(httpServer);

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`✅  Altec Totem Mock API running at http://127.0.0.1:${PORT}/v1`);
  console.log(`    WebSocket:  ws://127.0.0.1:${PORT}/v1/ws?api_key=ksk_mock_altec_001`);
  console.log(`    API docs:   openapi.yaml`);
  console.log(`    Auth:       Authorization: ApiKey ksk_mock_altec_001`);
});
