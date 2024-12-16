import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const MockUSDTModule = buildModule('MockUSDTModule', m => {
  const mockUSDT = m.contract('ERC20Mock', ['USDT', 'USDT', 6]);

  return { mockUSDT };
});

export default MockUSDTModule;
