import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const MockETHModule = buildModule('MockETHModule', m => {
  const mockETH = m.contract('ERC20Mock', ['Ethereum', 'ETH', 18]);

  return { mockETH };
});

export default MockETHModule;
