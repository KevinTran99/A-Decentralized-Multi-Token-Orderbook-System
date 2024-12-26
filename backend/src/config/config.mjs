import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PROVIDER: {
    ALCHEMY_KEY: process.env.ALCHEMY_KEY || '',
  },
  CONTRACTS: {
    ORDERBOOKDEX: process.env.ORDERBOOKDEX_ADDRESS || '',
  },
  FEE_PERCENT: 100,
};
