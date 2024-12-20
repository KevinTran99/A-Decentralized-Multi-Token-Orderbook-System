import { SUPPORTED_TOKENS } from '../config/tokens.mjs';
import { orderbook } from '../startup.mjs';

export const getOrderBook = (req, res) => {
  try {
    const { pair } = req.params;
    const symbol = pair.split('-')[0];
    const token = SUPPORTED_TOKENS.find(t => t.symbol === symbol);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token pair',
      });
    }

    const orders = orderbook.getOrderBook(token.address);

    res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error('Error fetching orderbook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orderbook',
    });
  }
};
