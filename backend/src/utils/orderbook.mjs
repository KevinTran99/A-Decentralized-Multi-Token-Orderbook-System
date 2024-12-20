class Orderbook {
  constructor() {
    this.ordersByToken = new Map();
    this.orderMap = new Map();
  }

  processOrders(activeOrders) {
    this.ordersByToken.clear();
    this.orderMap.clear();
    activeOrders.forEach(order => this.addOrder(order));
  }

  addOrder(order) {
    if (!this.ordersByToken.has(order.token)) {
      this.ordersByToken.set(order.token, { bids: [], asks: [] });
    }

    const orders = this.ordersByToken.get(order.token);
    const orderList = order.isBuyOrder ? orders.bids : orders.asks;

    orderList.push(order);
    this.orderMap.set(order.orderId, order);

    orderList.sort((a, b) => {
      const priceDiff = BigInt(b.price) - BigInt(a.price);
      return order.isBuyOrder ? Number(priceDiff) : -Number(priceDiff);
    });
  }

  getOrderBook(token) {
    const orders = this.ordersByToken.get(token);
    if (!orders) return { bids: [], asks: [] };

    const aggregateOrders = (orderList, isBids) => {
      const priceMap = new Map();

      orderList.forEach(order => {
        const available = BigInt(order.amount) - BigInt(order.filled);
        if (available > 0n) {
          priceMap.set(order.price, (priceMap.get(order.price) || 0n) + available);
        }
      });

      return Array.from(priceMap.entries())
        .map(([price, size]) => ({
          price,
          size: size.toString(),
        }))
        .sort((a, b) => {
          const priceDiff = BigInt(b.price) - BigInt(a.price);
          return isBids ? Number(priceDiff) : -Number(priceDiff);
        });
    };

    return {
      bids: aggregateOrders(orders.bids, true),
      asks: aggregateOrders(orders.asks, false),
    };
  }
}

export default Orderbook;
