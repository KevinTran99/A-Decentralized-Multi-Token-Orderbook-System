import express from 'express';
import { getOrderBook } from '../controllers/orderbook-controller.mjs';

const router = express.Router();

router.route('/:pair').get(getOrderBook);

export default router;
