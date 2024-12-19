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
}

export default Orderbook;
