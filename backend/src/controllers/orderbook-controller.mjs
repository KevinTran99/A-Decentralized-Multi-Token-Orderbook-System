import { orderbook } from '../startup.mjs';

export const getOrderBook = (req, res) => {
  try {
    const { pair } = req.params;
    const token = pair.split('-')[0];
    const orders = orderbook.getOrderBook(token);

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
