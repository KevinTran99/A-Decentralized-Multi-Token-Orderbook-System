import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/config.mjs';
import { SUPPORTED_TOKENS } from './config/tokens.mjs';
import orderBookRouter from './routes/orderbook-routes.mjs';
import { orderbook, blockchainService } from './startup.mjs';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use('/api/v1/orderbook', orderBookRouter);

const wss = new WebSocketServer({ server });

app.locals.broadcast = data => {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

wss.on('connection', ws => {
  console.log('Client connected');

  ws.on('message', message => {
    try {
      const { token } = JSON.parse(message);
      const orderBookData = orderbook.getOrderBook(token);
      ws.send(
        JSON.stringify({
          type: 'ORDERBOOK_UPDATE',
          token: token,
          data: orderBookData,
        })
      );
    } catch (error) {
      console.error('WebSocker error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

app.get('/health', (_, res) => res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() }));

async function initialize() {
  try {
    for (const token of SUPPORTED_TOKENS) {
      const activeOrders = await blockchainService.getActiveOrders(token.address);
      orderbook.processOrders(activeOrders);
    }

    blockchainService.listenToEvents({
      onOrderCreated: createdOrder => {
        orderbook.handleOrderCreated(createdOrder);
        const updatedOrderBook = orderbook.getOrderBook(createdOrder.token);
        app.locals.broadcast({
          type: 'ORDERBOOK_UPDATE',
          token: createdOrder.token,
          data: updatedOrderBook,
        });
      },
      onOrderFilled: filledOrder => {
        orderbook.handleOrderFilled(filledOrder);
        const updatedOrderBook = orderbook.getOrderBook(filledOrder.token);
        app.locals.broadcast({
          type: 'ORDERBOOK_UPDATE',
          token: filledOrder.token,
          data: updatedOrderBook,
        });
      },
      onOrderCancelled: cancelledOrder => {
        orderbook.handleOrderCancelled(cancelledOrder);
        const updatedOrderBook = orderbook.getOrderBook(cancelledOrder.token);
        app.locals.broadcast({
          type: 'ORDERBOOK_UPDATE',
          token: cancelledOrder.token,
          data: updatedOrderBook,
        });
      },
    });

    setInterval(() => {
      const updatedTokens = orderbook.cleanExpiredReservations();

      updatedTokens.forEach(token => {
        const updatedOrderBook = orderbook.getOrderBook(token);
        app.locals.broadcast({
          type: 'ORDERBOOK_UPDATE',
          token: token,
          data: updatedOrderBook,
        });
      });
    }, 1000);
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
