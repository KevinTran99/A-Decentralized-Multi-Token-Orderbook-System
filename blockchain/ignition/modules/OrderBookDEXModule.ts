import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const OrderBookDEXModule = buildModule('OrderBookDEXModule', m => {
  const usdtAddress = '0xF08dFB023382187c0b59A175D1Dc0b186e867f8B';

  const orderBookDEX = m.contract('OrderBookDEX', [usdtAddress]);

  return { orderBookDEX };
});

export default OrderBookDEXModule;
