import { SUPPORTED_TOKENS } from '../config/tokens.mjs';
import { config } from '../config/config.mjs';

class Orderbook {
  constructor() {
    this.ordersByToken = new Map();
    this.orderMap = new Map();
    this.reservations = new Map();
  }

  processOrders(activeOrders) {
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

      if (priceDiff !== 0n) {
        return order.isBuyOrder ? Number(priceDiff) : -Number(priceDiff);
      }

      return Number(BigInt(a.timestamp) - BigInt(b.timestamp));
    });
  }

  removeOrder(order) {
    const orders = this.ordersByToken.get(order.token);
    if (!orders) return;

    const ordersList = order.isBuyOrder ? orders.bids : orders.asks;
    const index = ordersList.findIndex(o => o.orderId === order.orderId);

    if (index !== -1) {
      ordersList.splice(index, 1);
      this.orderMap.delete(order.orderId);
    }
  }

  handleOrderCreated(createdOrder) {
    console.log('Order created:', createdOrder);
    this.addOrder(createdOrder);
  }

  handleOrderFilled(filledOrder) {
    console.log('Order filled:', filledOrder);
    const order = this.orderMap.get(filledOrder.orderId);
    if (!order) return;

    order.filled = (BigInt(order.filled) + BigInt(filledOrder.filled)).toString();

    const reservation = this.reservations.get(filledOrder.orderId);
    if (reservation) {
      reservation.totalReserved -= BigInt(filledOrder.filled);
    }

    if (BigInt(order.filled) === BigInt(order.amount)) {
      this.reservations.delete(filledOrder.orderId);
      this.removeOrder(order);
    }
  }

  handleOrderCancelled(cancelledOrder) {
    console.log('Order cancelled:', cancelledOrder);
    this.reservations.delete(cancelledOrder.orderId);
    const order = this.orderMap.get(cancelledOrder.orderId);
    if (!order) return;

    this.removeOrder(order);
  }

  findMarketBuyMatches(token, amount, maxPrice) {
    const orders = this.ordersByToken.get(token);
    if (!orders?.asks?.length) return null;

    const tokenConfig = SUPPORTED_TOKENS.find(t => t.address === token);
    if (!tokenConfig) return null;

    let remainingAmount = BigInt(amount);
    const matches = { orderIds: [], amounts: [], totalUsdt: 0n };

    for (const order of orders.asks) {
      if (remainingAmount <= 0n) break;
      if (BigInt(order.price) > BigInt(maxPrice)) break;

      const reservation = this.reservations.get(order.orderId) || { totalReserved: 0n };
      const availableAmount = BigInt(order.amount) - BigInt(order.filled) - reservation.totalReserved;
      if (availableAmount <= 0n) continue;

      const fillAmount = remainingAmount > availableAmount ? availableAmount : remainingAmount;

      const orderCost = (fillAmount * BigInt(order.price)) / BigInt(10 ** tokenConfig.decimals);

      matches.orderIds.push(order.orderId);
      matches.amounts.push(fillAmount.toString());
      matches.totalUsdt += orderCost;
      remainingAmount -= fillAmount;
    }

    if (matches.orderIds.length === 0) return null;

    const fee = (matches.totalUsdt * BigInt(config.FEE_PERCENT)) / 10000n;
    matches.totalUsdt += fee;

    return {
      orderIds: matches.orderIds,
      amounts: matches.amounts,
      totalUsdt: matches.totalUsdt.toString(),
    };
  }

  findMarketSellMatches(token, amount, minPrice) {
    const orders = this.ordersByToken.get(token);
    if (!orders?.bids?.length) return null;

    const tokenConfig = SUPPORTED_TOKENS.find(t => t.address === token);
    if (!tokenConfig) return null;

    let remainingAmount = BigInt(amount);
    const matches = { orderIds: [], amounts: [], totalTokens: 0n };

    for (const order of orders.bids) {
      if (remainingAmount <= 0n) break;
      if (BigInt(order.price) < BigInt(minPrice)) break;

      const reservation = this.reservations.get(order.orderId) || { totalReserved: 0n };
      const availableAmount = BigInt(order.amount) - BigInt(order.filled) - reservation.totalReserved;
      if (availableAmount <= 0n) continue;

      const fillAmount = remainingAmount > availableAmount ? availableAmount : remainingAmount;

      matches.orderIds.push(order.orderId);
      matches.amounts.push(fillAmount.toString());
      matches.totalTokens += fillAmount;
      remainingAmount -= fillAmount;
    }

    if (matches.orderIds.length === 0) return null;

    return {
      orderIds: matches.orderIds,
      amounts: matches.amounts,
      token: token,
      totalTokens: matches.totalTokens.toString(),
    };
  }

  createReservation(matches) {
    const expiresAt = Date.now() + 30000;

    matches.orderIds.forEach((orderId, index) => {
      const reservedAmount = BigInt(matches.amounts[index]);
      const reservation = this.reservations.get(orderId) || { totalReserved: 0n, reservations: [] };

      reservation.totalReserved += reservedAmount;
      reservation.reservations.push({ amount: reservedAmount.toString(), expiresAt });

      this.reservations.set(orderId, reservation);
    });

    return { expiresAt, matches };
  }

  cleanExpiredReservations() {
    const now = Date.now();
    const updates = new Set();

    for (const [orderId, reservation] of this.reservations.entries()) {
      reservation.reservations = reservation.reservations.filter(res => {
        if (now <= res.expiresAt) return true;

        reservation.totalReserved -= BigInt(res.amount);

        const order = this.orderMap.get(orderId);
        if (order) {
          updates.add(order.token);
        }

        return false;
      });

      if (reservation.reservations.length === 0) {
        this.reservations.delete(orderId);
      }
    }

    return Array.from(updates);
  }

  getOrderBook(token) {
    const orders = this.ordersByToken.get(token);
    if (!orders) return { bids: [], asks: [] };

    const aggregateOrders = (orderList, isBids) => {
      const priceMap = new Map();

      orderList.forEach(order => {
        const reservation = this.reservations.get(order.orderId) || { totalReserved: 0n };
        const available = BigInt(order.amount) - BigInt(order.filled) - reservation.totalReserved;
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
