import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const MockBTCModule = buildModule('MockBTCModule', m => {
  const mockBTC = m.contract('ERC20Mock', ['Bitcoin', 'BTC', 8]);

  return { mockBTC };
});

export default MockBTCModule;
