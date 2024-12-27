import express from 'express';
import { getOrderBook } from '../controllers/orderbook-controller.mjs';
import { findMatches } from '../controllers/orderbook-controller.mjs';

const router = express.Router();

router.route('/:pair').get(getOrderBook);
router.route('/find-matches').post(findMatches);

export default router;
