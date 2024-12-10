import { expect } from 'chai';
import hre from 'hardhat';

describe('OrderBookDEX', function () {
  async function deployOrderBookDEXFixture() {
    const [owner, user1, user2, user3] = await hre.ethers.getSigners();

    const ERC20Mock = await hre.ethers.getContractFactory('ERC20Mock');
    const USDT = await ERC20Mock.deploy('USDT', 'USDT', 6);
    const ETH = await ERC20Mock.deploy('Ethereum', 'ETH', 18);

    const OrderBookDEX = await hre.ethers.getContractFactory('OrderBookDEX');
    const orderBookDEX = await OrderBookDEX.deploy(await USDT.getAddress());

    const usdtAmount = hre.ethers.parseUnits('10000', 6);
    const ethAmount = hre.ethers.parseUnits('1000', 18);

    await USDT.transfer(user1.address, usdtAmount);
    await USDT.transfer(user2.address, usdtAmount);
    await USDT.transfer(user3.address, usdtAmount);
    await ETH.transfer(user1.address, ethAmount);
    await ETH.transfer(user2.address, ethAmount);
    await ETH.transfer(user3.address, ethAmount);

    return { orderBookDEX, USDT, ETH, owner, user1, user2, user3 };
  }

  describe('Deployment', function () {
    it('Should assign deployer the DEFAULT_ADMIN_ROLE and PAIR_LISTER_ROLE', async function () {
      const { orderBookDEX, owner } = await deployOrderBookDEXFixture();
      const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const PAIR_LISTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('PAIR_LISTER_ROLE'));

      expect(await orderBookDEX.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await orderBookDEX.hasRole(PAIR_LISTER_ROLE, owner.address)).to.be.true;
    });

    it('Should set the correct USDT address', async function () {
      const { orderBookDEX, USDT } = await deployOrderBookDEXFixture();

      expect(await orderBookDEX.USDT()).to.equal(await USDT.getAddress());
    });
  });

  describe('Token listing', function () {
    it('Should allow PAIR_LISTER_ROLE to list a token', async function () {
      const { orderBookDEX, ETH, owner } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(await ETH.getAddress()))
        .to.emit(orderBookDEX, 'TokenListed')
        .withArgs(await ETH.getAddress(), 18, owner.address);
    });

    it('Should not allow non PAIR_LISTER_ROLE to list a token', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.connect(user1).listToken(await ETH.getAddress())).to.be.revertedWithCustomError(
        orderBookDEX,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('Should not allow listing of zero address', async function () {
      const { orderBookDEX } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(orderBookDEX, 'ZeroAddress')
        .withArgs(hre.ethers.ZeroAddress);
    });

    it('Should not allow listing an already listed token', async function () {
      const { orderBookDEX, ETH } = await deployOrderBookDEXFixture();

      await orderBookDEX.listToken(await ETH.getAddress());
      await expect(orderBookDEX.listToken(await ETH.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenAlreadyListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should not allow listing USDT as a trading token pair', async function () {
      const { orderBookDEX, USDT } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(await USDT.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'CannotListUsdt')
        .withArgs(await USDT.getAddress());
    });
  });
});
