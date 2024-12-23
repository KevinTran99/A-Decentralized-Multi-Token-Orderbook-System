import { ethers } from 'ethers';
import { config } from '../config/config.mjs';
import contractAbi from '../orderbook-dex-abi.json' assert { type: 'json' };

class BlockchainService {
  constructor() {
    this.initializeConnection();
  }

  initializeConnection() {
    this.wsProvider = new ethers.WebSocketProvider(`wss://eth-sepolia.g.alchemy.com/v2/${config.PROVIDER.ALCHEMY_KEY}`);

    this.contract = new ethers.Contract(config.CONTRACTS.ORDERBOOKDEX, contractAbi, this.wsProvider);

    this.wsProvider.on('error', () => {
      setTimeout(() => this.initializeConnection(), 5000);
    });
  }

  listenToEvents({ onOrderCreated, onOrderFilled, onOrderCancelled }) {
    this.contract.on('OrderCreated', (orderId, maker, token, isBuyOrder, price, amount, timestamp) => {
      onOrderCreated({
        orderId: orderId.toString(),
        maker,
        token,
        isBuyOrder,
        price: price.toString(),
        amount: amount.toString(),
        filled: '0',
        timestamp: timestamp.toString(),
      });
    });

    this.contract.on(
      'OrderFilled',
      (orderId, maker, taker, token, isBuyOrder, price, filled, usdtAmount, feeAmount, timestamp) => {
        onOrderFilled({
          orderId: orderId.toString(),
          maker,
          taker,
          token,
          isBuyOrder,
          price: price.toString(),
          filled: filled.toString(),
          usdtAmount: usdtAmount.toString(),
          feeAmount: feeAmount.toString(),
          timestamp: timestamp.toString(),
        });
      }
    );

    this.contract.on('OrderCancelled', (orderId, maker, token, timestamp) => {
      onOrderCancelled({
        orderId: orderId.toString(),
        maker,
        token,
        timestamp: timestamp.toString(),
      });
    });
  }

  async getActiveOrders(token) {
    const orders = await this.contract.getActiveOrders(token);
    return orders.map(order => ({
      orderId: order.orderId.toString(),
      maker: order.maker,
      token: order.token,
      isBuyOrder: order.isBuyOrder,
      price: order.price.toString(),
      amount: order.amount.toString(),
      filled: order.filled.toString(),
      timestamp: Math.floor(Date.now() / 1000).toString(),
    }));
  }
}

export default BlockchainService;
