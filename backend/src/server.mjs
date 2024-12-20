import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config/config.mjs';
import orderBookRouter from './routes/orderbook-routes.mjs';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use('/api/v1/orderbook', orderBookRouter);

app.get('/health', (_, res) => res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() }));

const PORT = config.PORT;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} in ${config.NODE_ENV} mode`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
