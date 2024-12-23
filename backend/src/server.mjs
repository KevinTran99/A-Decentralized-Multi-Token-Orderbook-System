import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config/config.mjs';
import orderBookRouter from './routes/orderbook-routes.mjs';
import { orderbook, blockchainService } from './startup.mjs';
import { SUPPORTED_TOKENS } from './config/tokens.mjs';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use('/api/v1/orderbook', orderBookRouter);

app.get('/health', (_, res) => res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() }));

async function initialize() {
  try {
    for (const token of SUPPORTED_TOKENS) {
      const activeOrders = await blockchainService.getActiveOrders(token.address);
      orderbook.processOrders(activeOrders);
    }

    blockchainService.listenToEvents({
      onOrderCreated: createdOrder => orderbook.handleOrderCreated(createdOrder),
      onOrderFilled: filledOrder => orderbook.handleOrderFilled(filledOrder),
      onOrderCancelled: cancelledOrder => orderbook.handleOrderCancelled(cancelledOrder),
    });
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

const PORT = config.PORT;
server.listen(PORT, async () => {
  await initialize();
  console.log(`Server is running on port ${PORT} in ${config.NODE_ENV} mode`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
